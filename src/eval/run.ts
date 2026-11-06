import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { endPools } from '../db.js';
import { search, tuning, type Hit, type Mode } from '../search.js';
import { percentile } from './stats.js';

/**
 * Golden set line: which chunk(s) must be retrieved for a question.
 * A hit matches a `relevant` entry when the source matches AND
 * (`contains` is a substring of the chunk, or `page` equals the chunk page, or neither is given).
 */
export type Golden = {
  id: string;
  question: string;
  answer?: string;
  relevant: { source: string; contains?: string; page?: number }[];
  tenant?: string;
  /** Caller principals for this question (default none: only tenant-wide documents are visible). */
  principals?: string[];
  /** direct lookup · paraphrase (no statute vocabulary) · hard (same words, different law) · refusal (corpus cannot answer; `relevant` is empty) */
  kind?: 'direct' | 'paraphrase' | 'hard' | 'refusal';
};

export type Metrics = {
  n: number;
  recall: number;
  mrr: number;
  ms: number;
  p95: number;
  misses: string[];
  /** per `kind`, when the golden set carries kinds */
  byKind: Record<string, { n: number; recall: number; mrr: number }>;
};

export function matches(h: Hit, r: Golden['relevant'][number]): boolean {
  if (!h.source.endsWith(r.source)) return false;
  if (r.contains && !h.content.toLowerCase().includes(r.contains.toLowerCase())) return false;
  if (r.page !== undefined && h.page !== r.page) return false;
  return true;
}

/** recall@k = share of relevant entries found in the top k; mrr = 1/rank of the first hit. */
export function score(hits: Hit[], g: Golden): { recall: number; rr: number } {
  const found = g.relevant.filter((r) => hits.some((h) => matches(h, r))).length;
  const first = hits.findIndex((h) => g.relevant.some((r) => matches(h, r)));
  return { recall: found / g.relevant.length, rr: first < 0 ? 0 : 1 / (first + 1) };
}

export async function evaluate(
  golden: Golden[],
  mode: Mode,
  k: number,
  tenant?: string,
): Promise<Metrics> {
  let recall = 0,
    mrr = 0;
  const times: number[] = [];
  const misses: string[] = [];
  const byKind: Metrics['byKind'] = {};
  // refusal questions have nothing to retrieve; they are scored by the judge (answers.ts), not here
  const scored = golden.filter((g) => g.relevant.length > 0);
  for (const g of scored) {
    const t0 = Date.now();
    const hits = await search(g.question, mode, k, tenant ?? g.tenant ?? 'public', g.principals);
    times.push(Date.now() - t0);
    const s = score(hits, g);
    recall += s.recall;
    mrr += s.rr;
    if (s.recall < 1) misses.push(g.id);
    if (g.kind) {
      const b = (byKind[g.kind] ??= { n: 0, recall: 0, mrr: 0 });
      b.n++;
      b.recall += s.recall;
      b.mrr += s.rr;
    }
  }
  for (const b of Object.values(byKind)) {
    b.recall /= b.n;
    b.mrr /= b.n;
  }
  const n = scored.length || 1;
  const p95 = percentile(times, 0.95);
  const ms = Math.round(times.reduce((a, b) => a + b, 0) / n);
  return { n: scored.length, recall: recall / n, mrr: mrr / n, ms, p95, misses, byKind };
}

/** Prettier-aligned markdown table for the README (left-aligned cells, widest cell sets the width). */
export function readmeTable(results: Record<string, Metrics>, k: number): string {
  const rows = [
    ['Retrieval mode', `recall@${k}`, 'MRR', 'avg ms', 'p95 ms'],
    ...Object.entries({ dense: 'dense', fts: 'full-text', hybrid: 'hybrid (RRF)' }).map(
      ([m, name]) => {
        const r = results[m]!;
        return [name, r.recall.toFixed(3), r.mrr.toFixed(3), String(r.ms), String(r.p95)];
      },
    ),
  ];
  const w = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(w[i]!)).join(' | ')} |`;
  const sep = `| ${w.map((n) => '-'.repeat(n)).join(' | ')} |`;
  return [
    line(rows[0]!),
    sep,
    ...rows.slice(1).map(line),
    '',
    `_${results.hybrid!.n} golden questions, measured ${new Date().toISOString().slice(0, 10)} with \`pnpm eval --readme\`._`,
  ].join('\n');
}

export async function loadGolden(file = 'golden/golden.jsonl'): Promise<Golden[]> {
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => JSON.parse(l) as Golden);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const k = Number(flag('k') ?? 10);
  const gate = args.includes('--gate');
  const readme = args.includes('--readme');
  const tenant = flag('tenant');
  // tuning overrides, e.g. --rrf-k=20 --candidates=100 --ef-search=200 --stopwords
  if (flag('rrf-k')) tuning.rrfK = Number(flag('rrf-k'));
  if (flag('candidates')) tuning.candidates = Number(flag('candidates'));
  if (flag('ef-search')) tuning.efSearch = Number(flag('ef-search'));
  if (args.includes('--stopwords')) tuning.stopwords = true;
  if (flag('rerank')) tuning.rerank = flag('rerank') as typeof tuning.rerank;
  if (flag('rerank-top')) tuning.rerankTop = Number(flag('rerank-top'));
  if (flag('multi-query')) tuning.multiQuery = Number(flag('multi-query'));
  const modes: Mode[] = ['dense', 'fts', 'hybrid'];
  (async () => {
    const golden = await loadGolden(flag('golden'));
    const results: Record<string, Metrics> = {};
    for (const m of modes) results[m] = await evaluate(golden, m, k, tenant);

    console.log(`golden set: ${golden.length} questions, k=${k}\n`);
    console.log('mode    recall@k  MRR    avg ms  p95 ms');
    for (const m of modes) {
      const r = results[m]!;
      console.log(
        `${m.padEnd(7)} ${r.recall.toFixed(3).padStart(8)}  ${r.mrr.toFixed(3)}  ${String(r.ms).padStart(6)}  ${String(r.p95).padStart(6)}`,
      );
    }
    const kinds = Object.entries(results.hybrid!.byKind);
    if (kinds.length) {
      console.log('\nhybrid by kind');
      for (const [kind, b] of kinds)
        console.log(
          `  ${kind.padEnd(11)} n=${String(b.n).padStart(2)}  recall ${b.recall.toFixed(3)}  mrr ${b.mrr.toFixed(3)}`,
        );
    }
    if (results.hybrid!.misses.length)
      console.log(`\nhybrid misses: ${results.hybrid!.misses.join(', ')}`);
    if (readme) {
      const md = await readFile('README.md', 'utf8');
      const [a, b] = ['<!-- eval:start -->', '<!-- eval:end -->'];
      const i = md.indexOf(a),
        j = md.indexOf(b);
      if (i < 0 || j < 0) throw new Error('README.md is missing the eval markers');
      await writeFile(
        'README.md',
        md.slice(0, i + a.length) + '\n\n' + readmeTable(results, k) + '\n' + md.slice(j),
      );
      console.log('\nREADME.md numbers updated');
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(
      path.join('eval/results', `${stamp}.json`),
      JSON.stringify({ k, tenant, tuning, results }, null, 2),
    );

    if (gate) {
      const thresholds = JSON.parse(await readFile('eval/thresholds.json', 'utf8')) as Record<
        string,
        { recall: number; mrr: number }
      >;
      let failed = false;
      for (const [m, t] of Object.entries(thresholds)) {
        const r = results[m];
        if (!r) continue;
        if (r.recall < t.recall || r.mrr < t.mrr) {
          console.error(
            `GATE FAILED ${m}: recall ${r.recall.toFixed(3)} < ${t.recall} or mrr ${r.mrr.toFixed(3)} < ${t.mrr}`,
          );
          failed = true;
        }
      }
      if (failed) process.exit(1);
      console.log('\ngate passed');
    }
    await endPools();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
