import { rerank as aiRerank } from 'ai';
import { cohere } from '@ai-sdk/cohere';
import { voyage } from '@ai-sdk/voyage';
import type { Hit } from './search.js';
import { span } from './telemetry.js';

export type RerankProvider = 'none' | 'overlap' | 'local' | 'cohere' | 'voyage';

const localModelId = process.env.RERANK_MODEL ?? 'Xenova/bge-reranker-base';

/** Cross-encoder reranking: score each (query, chunk) pair jointly and re-sort. Returns all hits, best first. */
export function rerank(q: string, hits: Hit[], provider: RerankProvider): Promise<Hit[]> {
  if (provider === 'none' || hits.length < 2) return Promise.resolve(hits);
  return span('rerank', { provider, n: hits.length }, async () => {
    const scores =
      provider === 'overlap'
        ? overlapScores(q, hits)
        : provider === 'local'
          ? await localScores(q, hits)
          : await apiScores(q, hits, provider);
    return hits.map((h, i) => ({ ...h, score: scores[i]! })).sort((a, b) => b.score - a.score);
  });
}

/** Baseline that needs no model: share of distinct query terms present in the chunk. */
export function overlapScores(q: string, hits: Hit[]): number[] {
  const terms = [
    ...new Set(
      q
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 3),
    ),
  ];
  return hits.map((h) => {
    const text = h.content.toLowerCase();
    return terms.length ? terms.filter((t) => text.includes(t)).length / terms.length : 0;
  });
}

// Model and tokenizer are loaded once per process (first call downloads to the HF cache, ~100-300 MB).
let local: Promise<{ tok: any; model: any }> | undefined;
async function localScores(q: string, hits: Hit[]): Promise<number[]> {
  local ??= import('@huggingface/transformers').then(async (t) => ({
    tok: await t.AutoTokenizer.from_pretrained(localModelId),
    model: await t.AutoModelForSequenceClassification.from_pretrained(localModelId),
  }));
  const { tok, model } = await local;
  const inputs = tok(new Array(hits.length).fill(q), {
    text_pair: hits.map((h) => h.content),
    padding: true,
    truncation: true,
  });
  const { logits } = await model(inputs);
  return (logits.sigmoid().tolist() as number[][]).map((r) => r[0]!);
}

async function apiScores(q: string, hits: Hit[], provider: 'cohere' | 'voyage'): Promise<number[]> {
  const { ranking } = await aiRerank({
    model:
      provider === 'cohere'
        ? cohere.reranking(process.env.COHERE_RERANK_MODEL ?? 'rerank-v3.5')
        : voyage.reranking(process.env.VOYAGE_RERANK_MODEL ?? 'rerank-2.5'), // 2.5 is the newest Voyage reranker documented as multilingual
    query: q,
    documents: hits.map((h) => h.content),
  });
  const scores = new Array<number>(hits.length).fill(0);
  for (const r of ranking) scores[r.originalIndex] = r.score;
  return scores;
}
