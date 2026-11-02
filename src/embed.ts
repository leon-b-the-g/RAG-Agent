import { createHash } from 'node:crypto';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';

export const DIM = 1536;
const provider = process.env.EMBED_PROVIDER ?? 'openai';
const modelId = process.env.EMBED_MODEL ?? 'text-embedding-3-small';

export async function embed(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  if (provider === 'fake') return values.map(fakeEmbedding);
  const { embeddings } = await embedMany({
    model: openai.embeddingModel(modelId as 'text-embedding-3-small'),
    values,
    maxParallelCalls: 4,
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
