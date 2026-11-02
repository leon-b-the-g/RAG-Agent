# 20 — Evaluation and test plan

## Golden set

- 55 questions in `golden/golden.jsonl` over 18 laws, each with a `kind` (21 direct, 21 paraphrase, 9 hard negatives, 4 refusals). Drafted by a model from statute knowledge without reading the corpus — which keeps question vocabulary independent of chunk text — then verified by Leon: every `contains` phrase must pass `pnpm golden:check` against the parsed PDFs. Refusal questions have an empty `relevant` list; retrieval metrics skip them and the judge scores them as correct only when the system refuses.
- `pnpm eval` reports recall and MRR per kind, so a change that helps paraphrases but hurts hard negatives is visible.
- Frozen once written; additions are appended with a date in the `id` so old results stay comparable.

## Metrics

| Metric       | Definition                                                                                                                                              | Target (hybrid, k=10) |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| recall@10    | share of relevant passages present in the top 10                                                                                                        | ≥ 0.85                |
| MRR          | mean of 1/rank of the first relevant passage                                                                                                            | ≥ 0.60                |
| faithfulness | `pnpm judge`: binary LLM judge (claims supported by the cited excerpts?), reported only with Cohen's κ against ≥ 30 human labels in `eval/labels.jsonl` | ≥ 0.90, κ ≥ 0.4       |
| p95 latency  | retrieval only, measured over the golden set                                                                                                            | stated, not gated     |
| € / query    | `pnpm answers`: generation tokens × `PRICE_*_PER_MTOK`; end-to-end p95 alongside                                                                        | stated                |

## Gate

`pnpm eval --gate` compares hybrid recall and MRR to `eval/thresholds.json`; `pnpm judge --gate` does the same for faithfulness and κ. Thresholds start at 0 and are raised by a human after each measured improvement; they never go down. The CI job `eval-gate` runs on push to `main` (needs `OPENAI_API_KEY` secret, ingests the corpus fresh).

## Tests

- `test/chunk.test.ts`: heading detection, section/page propagation, max/overlap invariants, PDF and TXT parsing on fixtures.
- `test/pipeline.test.ts`: migrate → ingest → fts/hybrid search → tenant isolation → eval scoring, against a real Postgres with fake embeddings.
- `test/leak.test.ts`: two tenants with identical vocabulary, one group-restricted document, 100 deterministic queries × 3 modes → zero cross-tenant or cross-ACL hits; principal validation; with `APP_DATABASE_URL` the app role must see zero rows without a caller context (RLS proof). CI runs it as the restricted role.
