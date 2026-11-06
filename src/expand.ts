import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { span } from './telemetry.js';

const modelId = process.env.QUERY_MODEL ?? 'claude-haiku-4-5';

/**
 * RAG-fusion: the question plus `n` paraphrases in the vocabulary a document would use
 * (statute wording instead of everyday wording). Each is searched on its own and the lists are
 * fused by reciprocal rank, so a question phrased unlike the text still reaches the right chunk.
 */
export function expandQuery(q: string, n: number): Promise<string[]> {
  return span('expand', { n }, async () => {
    const { object } = await generateObject({
      model: anthropic(modelId as 'claude-haiku-4-5'),
      schema: z.object({ queries: z.array(z.string()).max(n) }),
      prompt:
        `Formuliere ${n} alternative Suchanfragen zu dieser Frage, jede mit anderen Begriffen ` +
        `(Fach- und Gesetzessprache, Synonyme). Nur die Anfragen.\n\nFrage: ${q}`,
    });
    return [q, ...object.queries.filter((s) => s.trim() && s !== q)];
  });
}
