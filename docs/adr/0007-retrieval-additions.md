# ADR-0007: Retrieval additions — iterative HNSW scans, Voyage reranker, RAG-fusion, HTTP API

Date: 2026-11-06 · Status: accepted (defaults off until measured)

## Context

With tenant + ACL filtering in every query, pgvector's HNSW scan has a known failure: it collects `ef_search` (40) nearest neighbours _before_ the WHERE clause, so a tenant that owns 10 % of the rows gets ~4 results instead of k. pgvector 0.8 added iterative scans for exactly this. Reranking (ADR-0003) had three providers; Voyage's `rerank-2.5` is multilingual and now reachable through the same AI SDK call as Cohere. Finally, questions in everyday German ("Wann darf ich sonntags liefern?") often share no term with the statute text ("Sperrzeit", "Ladenschluss"); RAG-fusion (search the question plus model-written paraphrases, fuse by RRF) is the cheapest known fix.

## Decision

- `denseSearch` sets `hnsw.iterative_scan = relaxed_order` per transaction when the server's pgvector is ≥ 0.8 (checked once per process); older servers keep the old behaviour.
- `rerank.ts` gains `voyage` (`VOYAGE_RERANK_MODEL`, default `rerank-2.5`); `pnpm experiment rerank` includes it when the key is set.
- `tuning.multiQuery` (default 0): number of paraphrases from `QUERY_MODEL` (Haiku, structured output). Each query runs the chosen mode; lists are fused with the existing `fuse()`. `pnpm eval --multi-query=2`, `pnpm experiment multiquery`.
- `ANSWER_K` (default 10, was 8): excerpts shown to the answer model, following the 10–20 finding in the contextual-retrieval study.
- `src/server.ts` (`pnpm serve`): `node:http`, `GET /health`, `POST /search`, `POST /ask`, and the one-page demo at `/`. No framework. The caller identity in the body is trusted; an auth proxy in front is the deployment's job (ADR-0005-hosting, still open → now ADR-0008).

## Consequences

- Defaults for reranker and multi-query stay `none` / `0` per CLAUDE.md: they move only after `pnpm experiment` shows a gain on real embeddings. The code paths are tested for plumbing only.
- Multi-query costs one Haiku call per question (~0.001 €) and ~300 ms; reranking adds 100–400 ms.
- ADR-0005 (hosting) is renumbered to ADR-0008 and remains open.
