# ADR-0003: Reranker choice

Date: 2026-10-18 · Status: proposed — decided once `docs/experiments/rerank.md` has numbers from real embeddings

## Context

Hybrid retrieval ranks by two cheap signals (vector distance, term frequency) that never read the query and the chunk together. A cross-encoder does, at the cost of one model call over the top 50 candidates per query. Candidates:

| Option                                                   | Cost                          | Language                                                                                                                                                | Runs where                       |
| -------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| none                                                     | 0                             | —                                                                                                                                                       | —                                |
| overlap (share of query terms in chunk)                  | 0                             | any, naive                                                                                                                                              | in-process                       |
| local cross-encoder via Transformers.js (`RERANK_MODEL`) | CPU ~0.3–2 s / 50 pairs, free | depends on model; multilingual candidates to test: `Xenova/bge-reranker-base`, a `bge-reranker-v2-m3` ONNX export, `jina-reranker-v2-base-multilingual` | in-process, model cached on disk |
| Cohere `rerank-v3.5` via AI SDK `rerank()`               | ~$2 / 1k queries              | multilingual, German strong                                                                                                                             | API, non-EU unless EU endpoint   |

## Decision

_To be filled from the experiment table: MRR and p95 for each option on the golden set with hard negatives._

## Consequences

- The default lands in `tuning.rerank`; `rerankTop` stays 50 unless the grid shows 25 is as good.
- If a local model wins, the first run downloads it (~100–300 MB) into the Hugging Face cache; CI uses `rerank=none` for the fast tests and the gate uses whatever the default is.
- If Cohere wins, document that query text leaves the EU unless the EU endpoint is configured, and keep `overlap` as the no-key fallback.
