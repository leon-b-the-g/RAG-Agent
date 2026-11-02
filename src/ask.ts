import { pathToFileURL } from 'node:url';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { endPools } from './db.js';
import { search, type Hit, type Mode } from './search.js';
import { flush, span } from './telemetry.js';

const modelId = process.env.ANSWER_MODEL ?? 'claude-sonnet-5-5';

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
      system:
        'Du beantwortest Fragen ausschließlich anhand der nummerierten Auszüge. Zitiere jede Aussage mit [n]. ' +
        'Wenn die Auszüge die Frage nicht beantworten, sage das klar und rate nicht.',
      prompt: `Auszüge:\n\n${context}\n\nFrage: ${question}`,
    }),
  );
  return { text: res.text, usage: res.usage, ms: Date.now() - t0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const q = args.filter((a) => !a.startsWith('--')).join(' ');
  const mode = (args.find((a) => a.startsWith('--mode='))?.slice(7) ?? 'hybrid') as Mode;
  const tenant = args.find((a) => a.startsWith('--tenant='))?.slice(9) ?? 'public';
  const principals =
    args
      .find((a) => a.startsWith('--as='))
      ?.slice(5)
      .split(',') ?? [];
  if (!q) {
    console.error(
      'usage: pnpm ask "Frage" [--mode=dense|fts|hybrid] [--tenant=public] [--as=user:leon,group:kitchen]',
    );
    process.exit(2);
  }
  span('ask', { mode, tenant, question: q }, async () => {
    const t0 = Date.now();
    const hits = await search(q, mode, 8, tenant, principals);
    const tRetrieve = Date.now() - t0;
    const a = await answer(q, hits);
    console.log(a.text);
    console.log('\n---');
    hits.forEach((h, i) =>
      console.log(
        `[${i + 1}] ${h.source}${h.page ? ` S. ${h.page}` : ''} ${h.section ?? ''} · sichtbar für: ${h.acl.join(', ')}`,
      ),
    );
    console.log(
      `\nretrieval ${tRetrieve} ms · generation ${a.ms} ms · tokens in/out ${a.usage.inputTokens}/${a.usage.outputTokens}`,
    );
    await flush();
    await endPools();
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
