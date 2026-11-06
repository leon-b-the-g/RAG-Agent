import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { Chunk } from './chunk.js';

/**
 * Contextual retrieval (Anthropic, 2024): a chunk embedded on its own loses what document and
 * section it belongs to, which is where many retrieval misses come from.
 *
 *   CONTEXTUALIZE=structural (default)  "title › section" — free, deterministic
 *   CONTEXTUALIZE=llm                   one model-written sentence per chunk; the document sits in a
 *                                       cached prompt prefix, so cost is ~1 € per million document tokens
 */
export const mode = process.env.CONTEXTUALIZE ?? 'structural';
const modelId = process.env.CONTEXT_MODEL ?? 'claude-haiku-4-5';
// shortcut: documents longer than this are cut for the prompt, when a corpus has >150k-char files split them per section first
const MAX_DOC_CHARS = 150_000;

export async function contextualize(title: string, pages: string[], chunks: Chunk[]) {
  const structural = chunks.map((c) => [title, c.section].filter(Boolean).join(' › '));
  if (mode !== 'llm') return structural;
  const doc = pages.join('\n\n').slice(0, MAX_DOC_CHARS);
  const out: string[] = [];
  for (const [i, c] of chunks.entries()) {
    const { text } = await generateText({
      model: anthropic(modelId as 'claude-haiku-4-5'),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `<document>\n${doc}\n</document>`,
              providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
            },
            {
              type: 'text',
              text:
                `Hier ist der Abschnitt, den wir innerhalb des Dokuments einordnen wollen:\n<chunk>\n${c.content}\n</chunk>\n` +
                'Gib einen kurzen, prägnanten Kontext (1–2 Sätze, Deutsch), der diesen Abschnitt im Gesamtdokument verortet, ' +
                'um die Suche zu verbessern. Antworte nur mit dem Kontext und sonst nichts.',
            },
          ],
        },
      ],
    });
    out.push(`${structural[i]} — ${text.trim()}`);
  }
  return out;
}
