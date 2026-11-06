import { pathToFileURL } from 'node:url';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { endPools } from './db.js';
import { search, type Hit, type Mode } from './search.js';
import { flush, span } from './telemetry.js';

const modelId = process.env.ANSWER_MODEL ?? 'claude-sonnet-5-5';
/** Excerpts handed to the model. Anthropic's contextual-retrieval study found 10–20 beats 5 for ~1k-char chunks. */
export const ANSWER_K = Number(process.env.ANSWER_K ?? 10);

const SYSTEM =
  'Du beantwortest Fragen ausschließlich anhand der nummerierten Auszüge. Zitiere jede Aussage mit [n]. ' +
  'Wenn die Auszüge die Frage nicht beantworten, sage das klar und rate nicht.';

export async function answer(question: string, hits: Hit[]) {
  const context = hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.source}${h.page ? ` S. ${h.page}` : ''}${h.section ? ` (${h.section})` : ''}\n${h.content}`,
    )
    .join('\n\n');
  const t0 = Date.now();
  const res = await span('answer', { model: modelId, hits: hits.length }, () =>
    generateText({
      model: anthropic(modelId as 'claude-sonnet-5-5'),
      system: SYSTEM,
      prompt: `Auszüge:\n\n${context}\n\nFrage: ${question}`,
    }),
  );
  return { text: res.text, usage: res.usage, ms: Date.now() - t0 };
}

export type AskOptions = { mode?: Mode; tenant?: string; principals?: string[]; k?: number };

/** Retrieve + answer as one traced unit; used by the CLI and the HTTP server. */
export function ask(question: string, o: AskOptions = {}) {
  const mode = o.mode ?? 'hybrid';
  const tenant = o.tenant ?? 'public';
  return span('ask', { mode, tenant, question }, async () => {
    const t0 = Date.now();
    const hits = await search(question, mode, o.k ?? ANSWER_K, tenant, o.principals ?? []);
    const retrieveMs = Date.now() - t0;
    const a = await answer(question, hits);
    return { text: a.text, hits, usage: a.usage, retrieveMs, answerMs: a.ms };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const q = args.filter((a) => !a.startsWith('--')).join(' ');
  const flag = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!q) {
    console.error(
      'usage: pnpm ask "Frage" [--mode=dense|fts|hybrid] [--tenant=public] [--as=user:leon,group:kitchen] [--k=10]',
    );
    process.exit(2);
  }
  ask(q, {
    mode: flag('mode') as Mode | undefined,
    tenant: flag('tenant'),
    principals: flag('as')?.split(','),
    k: flag('k') ? Number(flag('k')) : undefined,
  })
    .then(async (a) => {
      console.log(a.text);
      console.log('\n---');
      a.hits.forEach((h, i) =>
        console.log(
          `[${i + 1}] ${h.source}${h.page ? ` S. ${h.page}` : ''} ${h.section ?? ''} · sichtbar für: ${h.acl.join(', ')}`,
        ),
      );
      console.log(
        `\nretrieval ${a.retrieveMs} ms · generation ${a.answerMs} ms · tokens in/out ${a.usage.inputTokens}/${a.usage.outputTokens}`,
      );
      await flush();
      await endPools();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
