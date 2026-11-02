import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { endPools, query } from '../src/db.js';
import { evaluate, loadGolden, type Metrics } from '../src/eval/run.js';
import { ingestDir } from '../src/ingest/index.js';
import { tuning, type Mode } from '../src/search.js';

/**
 * Week-3 experiment grids. Each run appends a dated section with a results table to
 * docs/experiments/<name>.md, so the history of what was tried stays in the repo.
 *
 *   pnpm experiment chunking  [--corpus=corpus]            re-ingests the corpus once per config into tenant exp-<target>-<overlap>
 *   pnpm experiment fusion    [--tenant=public]            rrfK × candidate depth, hybrid only
 *   pnpm experiment efsearch  [--tenant=public]            hnsw.ef_search, dense + hybrid
 *   pnpm experiment stopwords [--tenant=public]            German question-word filter off/on, fts + hybrid
 *   pnpm experiment rerank    [--tenant=public]            none / overlap / local cross-encoder / Cohere over the top 50, hybrid
 * Common: --golden=golden/golden.jsonl --k=10
 */
const args = process.argv.slice(2);
const name = args[0];
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const k = Number(flag('k') ?? 10);
const tenant = flag('tenant') ?? 'public';
const golden = await loadGolden(flag('golden'));

type Row = { config: string; mode: Mode; m: Metrics };
const rows: Row[] = [];
const run = async (config: string, modes: Mode[], t = tenant) => {
  for (const mode of modes) {
    const m = await evaluate(golden, mode, k, t);
    rows.push({ config, mode, m });
    console.log(
      `${config.padEnd(32)} ${mode.padEnd(7)} recall ${m.recall.toFixed(3)}  mrr ${m.mrr.toFixed(3)}  p95 ${m.p95} ms`,
    );
  }
};

const defaults = { ...tuning };
switch (name) {
  case 'chunking': {
    const corpus = path.resolve(flag('corpus') ?? 'corpus');
    for (const target of [600, 1200, 2000])
      for (const overlap of [0, 150]) {
        const t = `exp-${target}-${overlap}`;
        console.log(`\ningesting ${t} …`);
        await query('DELETE FROM documents WHERE tenant_id = $1', [t]); // sha-skip would keep old chunking
        await ingestDir(corpus, t, { target, overlap, max: Math.round(target * 1.5) });
        await run(`target=${target} overlap=${overlap}`, ['dense', 'fts', 'hybrid'], t);
      }
    break;
  }
  case 'fusion':
    for (const rrfK of [20, 60, 100])
      for (const candidates of [25, 50, 100]) {
        Object.assign(tuning, defaults, { rrfK, candidates });
        await run(`rrfK=${rrfK} candidates=${candidates}`, ['hybrid']);
      }
    break;
  case 'efsearch':
    for (const efSearch of [0, 40, 100, 200]) {
      Object.assign(tuning, defaults, { efSearch });
      await run(`ef_search=${efSearch || 'default'}`, ['dense', 'hybrid']);
    }
    break;
  case 'rerank':
    for (const rerank of ['none', 'overlap', 'local', 'cohere'] as const) {
      if (rerank === 'cohere' && !process.env.COHERE_API_KEY) {
        console.log('cohere: skipped (no COHERE_API_KEY)');
        continue;
      }
      Object.assign(tuning, defaults, { rerank });
      const label =
        rerank === 'local'
          ? `rerank=local (${process.env.RERANK_MODEL ?? 'Xenova/bge-reranker-base'})`
          : `rerank=${rerank}`;
      await run(label, ['hybrid']).catch((e) =>
        console.log(`${label}: failed — ${(e as Error).message}`),
      );
    }
    break;
  case 'stopwords':
    for (const stopwords of [false, true]) {
      Object.assign(tuning, defaults, { stopwords });
      await run(`stopwords=${stopwords ? 'on' : 'off'}`, ['fts', 'hybrid']);
    }
    break;
  default:
    console.error(
      'usage: pnpm experiment <chunking|fusion|efsearch|stopwords|rerank> [--tenant=] [--golden=] [--k=]',
    );
    process.exit(2);
}
Object.assign(tuning, defaults);

const table = [
  `| config | mode | recall@${k} | MRR | avg ms | p95 ms |`,
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    (r) =>
      `| ${r.config} | ${r.mode} | ${r.m.recall.toFixed(3)} | ${r.m.mrr.toFixed(3)} | ${r.m.ms} | ${r.m.p95} |`,
  ),
].join('\n');
const best = rows.filter((r) => r.mode === 'hybrid').sort((a, b) => b.m.mrr - a.m.mrr)[0];
const section = `\n## ${new Date().toISOString().slice(0, 10)} · ${golden.length} questions · tenant ${tenant} · embeddings ${process.env.EMBED_PROVIDER ?? 'openai'}\n\n${table}\n\n${best ? `Best hybrid by MRR: **${best.config}** (recall ${best.m.recall.toFixed(3)}, MRR ${best.m.mrr.toFixed(3)}).` : ''}\n`;
await mkdir('docs/experiments', { recursive: true });
const file = `docs/experiments/${name}.md`;
await appendFile(file, section);
console.log(`\nappended to ${file}`);
await endPools();
