import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { answer } from '../ask.js';
import { endPools } from '../db.js';
import { search, type Mode } from '../search.js';
import { flush } from '../telemetry.js';
import { loadGolden } from './run.js';
import { euros, percentile } from './stats.js';

/**
 * Generate an answer for every golden question and record what the judge and the humans need:
 * the answer, the excerpts it saw, tokens and latency. Output: eval/answers/latest.jsonl (+ a dated copy).
 * Usage: pnpm answers [--mode=hybrid] [--tenant=] [--golden=] [--limit=30] [--k=8]
 */
export type Answered = {
  id: string;
  question: string;
  expected?: string;
  /** the corpus cannot answer this; the right behaviour is to say so */
  expectRefusal: boolean;
  answer: string;
  contexts: { source: string; page: number | null; section: string | null; content: string }[];
  tokens: { input: number; output: number };
  ms: { retrieve: number; answer: number };
};

export const PRICE = {
  // € per million tokens; set PRICE_INPUT_PER_MTOK / PRICE_OUTPUT_PER_MTOK in .env for a real figure
  input: Number(process.env.PRICE_INPUT_PER_MTOK ?? 0),
  output: Number(process.env.PRICE_OUTPUT_PER_MTOK ?? 0),
};

export function summarize(rows: Answered[]) {
  const e2e = rows.map((r) => r.ms.retrieve + r.ms.answer);
  const tokens = rows.reduce(
    (t, r) => ({ input: t.input + r.tokens.input, output: t.output + r.tokens.output }),
    { input: 0, output: 0 },
  );
  const n = rows.length || 1;
  return {
    n: rows.length,
    avgMs: Math.round(e2e.reduce((a, b) => a + b, 0) / n),
    p95Ms: percentile(e2e, 0.95),
    tokensPerQuery: { input: Math.round(tokens.input / n), output: Math.round(tokens.output / n) },
    eurosPerQuery: euros(tokens, PRICE) / n,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const mode = (flag('mode') ?? 'hybrid') as Mode;
  const k = Number(flag('k') ?? 8);
  const limit = Number(flag('limit') ?? Infinity);
  (async () => {
    const golden = (await loadGolden(flag('golden'))).slice(0, limit);
    const rows: Answered[] = [];
    for (const g of golden) {
      const t0 = Date.now();
      const hits = await search(
        g.question,
        mode,
        k,
        flag('tenant') ?? g.tenant ?? 'public',
        g.principals,
      );
      const retrieve = Date.now() - t0;
      const a = await answer(g.question, hits);
      rows.push({
        id: g.id,
        question: g.question,
        expected: g.answer,
        expectRefusal: g.relevant.length === 0,
        answer: a.text,
        contexts: hits.map((h) => ({
          source: h.source,
          page: h.page,
          section: h.section,
          content: h.content,
        })),
        tokens: { input: a.usage.inputTokens ?? 0, output: a.usage.outputTokens ?? 0 },
        ms: { retrieve, answer: a.ms },
      });
      console.log(
        `${g.id.padEnd(12)} ${retrieve + a.ms} ms  ${a.text.slice(0, 80).replace(/\n/g, ' ')}…`,
      );
    }
    await mkdir('eval/answers', { recursive: true });
    const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile('eval/answers/latest.jsonl', jsonl);
    await writeFile(`eval/answers/${stamp}.jsonl`, jsonl);
    const s = summarize(rows);
    console.log(
      `\n${s.n} answers · avg ${s.avgMs} ms · p95 ${s.p95Ms} ms · tokens/query ${s.tokensPerQuery.input}/${s.tokensPerQuery.output}` +
        (PRICE.input
          ? ` · €${s.eurosPerQuery.toFixed(4)}/query`
          : ' · set PRICE_*_PER_MTOK for €/query'),
    );
    await flush();
    await endPools();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
