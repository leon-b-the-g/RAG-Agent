import type pg from 'pg';
import { callerPrincipals, vec, withCaller, type Caller } from './db.js';
import { embed } from './embed.js';
import { span } from './telemetry.js';
import { rerank, type RerankProvider } from './rerank.js';
import { expandQuery } from './expand.js';

export type Mode = 'dense' | 'fts' | 'hybrid';

export type Hit = {
  id: number;
  source: string;
  title: string | null;
  section: string | null;
  page: number | null;
  content: string;
  score: number;
  tenant: string;
  /** Who may see the document this chunk came from ('*' = everyone in the tenant). */
  acl: string[];
};

const COLS = `c.id, d.source, d.title, c.section, c.page, c.content, d.tenant_id AS tenant,
  (SELECT array_agg(a.principal ORDER BY a.principal) FROM document_acl a WHERE a.document_id = d.id) AS acl`;
/** Visibility, enforced in SQL even when RLS is bypassed (owner connection): tenant + any matching ACL principal. */
const VISIBLE = `c.tenant_id = $2 AND EXISTS (
  SELECT 1 FROM document_acl a WHERE a.document_id = c.document_id AND a.principal = ANY ($3::text[]))`;

/** Retrieval knobs. Defaults are the measured best (see docs/experiments/); eval and experiment CLIs override them. */
export const tuning = {
  rrfK: 60,
  candidates: 50,
  /** 0 = pgvector default (40). Higher = better recall, slower. */
  efSearch: 0,
  /** Drop German question/modal words from the full-text query. */
  stopwords: false,
  /** Cross-encoder reranking of the top `rerankTop` candidates; see src/rerank.ts. */
  rerank: 'none' as RerankProvider,
  rerankTop: 50,
  /** RAG-fusion: number of model-written paraphrases searched alongside the question (0 = off). */
  multiQuery: 0,
};

/**
 * pgvector ≥ 0.8 can keep scanning the HNSW index until k rows pass the tenant/ACL filter; older
 * versions stop after ef_search candidates and return fewer rows for small tenants. Checked once.
 */
let iterativeScan: Promise<boolean> | undefined;
const hasIterativeScan = (c: pg.PoolClient) =>
  (iterativeScan ??= c
    .query<{ v: string }>("SELECT extversion AS v FROM pg_extension WHERE extname = 'vector'")
    .then((r) => (r.rows[0]?.v ?? '0').localeCompare('0.8', undefined, { numeric: true }) >= 0));

export async function denseSearch(
  c: pg.PoolClient,
  q: string,
  k: number,
  caller: Caller,
): Promise<Hit[]> {
  const [e] = await embed([q], 'query');
  // SET LOCAL lives in the caller transaction; the value is an integer we own, not user input.
  if (tuning.efSearch) await c.query(`SET LOCAL hnsw.ef_search = ${Math.trunc(tuning.efSearch)}`);
  if (await hasIterativeScan(c)) await c.query('SET LOCAL hnsw.iterative_scan = relaxed_order');
  const res = await c.query<Hit>(
    `SELECT ${COLS}, 1 - (c.embedding <=> $1::vector) AS score
       FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE ${VISIBLE}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $4`,
    [vec(e!), caller.tenant, callerPrincipals(caller), k],
  );
  return res.rows;
}

const STOPWORDS = new Set(
  'wann wie wer wo was warum wieso weshalb welche welcher welches wieviel wieviele viele darf dürfen muss müssen kann können soll sollen gibt gilt hoch lang lange ist sind wird werden hat haben man bei nach für von mit'.split(
    ' ',
  ),
);

/**
 * OR-of-terms query: a question like "Wann beginnt die Sperrzeit?" must not require every word
 * (websearch_to_tsquery ANDs them). ts_rank_cd then favours chunks matching more terms, more densely.
 */
export function toOrQuery(q: string): string {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !(tuning.stopwords && STOPWORDS.has(t)));
  return [...new Set(terms)].join(' | ');
}

export async function ftsSearch(
  c: pg.PoolClient,
  q: string,
  k: number,
  caller: Caller,
): Promise<Hit[]> {
  const tsq = toOrQuery(q);
  if (!tsq) return [];
  const res = await c.query<Hit>(
    `SELECT ${COLS}, ts_rank_cd(c.tsv, to_tsquery('german', $1)) AS score
       FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE ${VISIBLE} AND c.tsv @@ to_tsquery('german', $1)
      ORDER BY score DESC
      LIMIT $4`,
    [tsq, caller.tenant, callerPrincipals(caller), k],
  );
  return res.rows;
}

/** Reciprocal rank fusion (Cormack et al. 2009): score = Σ 1/(rrfK + rank). */
export function fuse(lists: Hit[][], rrfK = tuning.rrfK): Hit[] {
  const fused = new Map<number, Hit>();
  for (const list of lists) {
    list.forEach((h, rank) => {
      const prev = fused.get(h.id);
      const inc = 1 / (rrfK + rank + 1);
      fused.set(h.id, prev ? { ...prev, score: prev.score + inc } : { ...h, score: inc });
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

export async function hybridSearch(
  c: pg.PoolClient,
  q: string,
  k: number,
  caller: Caller,
): Promise<Hit[]> {
  const n = tuning.candidates;
  const lists = [await denseSearch(c, q, n, caller), await ftsSearch(c, q, n, caller)];
  return fuse(lists).slice(0, k);
}

/** Retrieve as a caller: `principals` are the user's ids/groups; tenant-wide ('*') documents are always included. */
export function search(
  q: string,
  mode: Mode,
  k: number,
  tenant = 'public',
  principals: string[] = [],
): Promise<Hit[]> {
  const caller = { tenant, principals };
  return span('retrieve', { mode, k, tenant, query: q, rerank: tuning.rerank }, () =>
    withCaller(caller, async (c) => {
      const n = tuning.rerank === 'none' ? k : Math.max(k, tuning.rerankTop);
      const one = (query: string) =>
        mode === 'dense'
          ? denseSearch(c, query, n, caller)
          : mode === 'fts'
            ? ftsSearch(c, query, n, caller)
            : hybridSearch(c, query, n, caller);
      const queries = tuning.multiQuery ? await expandQuery(q, tuning.multiQuery) : [q];
      const lists = await Promise.all(queries.map(one));
      const hits = (lists.length > 1 ? fuse(lists) : lists[0]!).slice(0, n);
      return (await rerank(q, hits, tuning.rerank)).slice(0, k);
    }),
  );
}
