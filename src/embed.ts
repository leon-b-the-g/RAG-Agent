import { createHash } from 'node:crypto';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { voyage } from '@ai-sdk/voyage';

export const provider = process.env.EMBED_PROVIDER ?? 'voyage';
export const modelId =
  process.env.EMBED_MODEL ?? (provider === 'openai' ? 'text-embedding-3-small' : 'voyage-4');
/** Vector width. `pnpm db:migrate` resizes chunks.embedding to this; changing it means re-ingesting. */
export const DIM = Number(process.env.EMBED_DIM ?? (provider === 'openai' ? 1536 : 1024));

/**
 * `kind` matters for asymmetric models: Voyage embeds queries and documents with different
 * instructions (inputType), which is worth a few recall points for short questions over long chunks.
 */
export async function embed(
  values: string[],
  kind: 'document' | 'query' = 'document',
): Promise<number[][]> {
  if (values.length === 0) return [];
  if (provider === 'fake') return values.map(fakeEmbedding);
  const { embeddings } = await embedMany({
    model:
      provider === 'openai'
        ? openai.embeddingModel(modelId as 'text-embedding-3-small')
        : voyage.embedding(modelId as 'voyage-4'),
    values,
    dimensions: DIM,
    maxParallelCalls: 4,
    providerOptions: provider === 'voyage' ? { voyage: { inputType: kind } } : undefined,
  });
  return embeddings;
}

/**
 * Deterministic bag-of-words hash embedding. No semantics, but identical words -> identical
 * directions, so the dense path can be exercised in tests and CI without an API key.
 */
export function fakeEmbedding(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    const h = createHash('sha1').update(w).digest();
    v[h.readUInt32BE(0) % DIM]! += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
