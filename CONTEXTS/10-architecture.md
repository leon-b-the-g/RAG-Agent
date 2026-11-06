# 10 — Architecture

## Components

| Component | Where                         | Tech                                                                                                                              | Notes                                                                                                                                                                                      |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parser    | `src/ingest/`                 | unpdf (pdf.js), mammoth, exceljs, own CSV/HTML, tesseract.js + @napi-rs/canvas                                                    | per page / per sheet; pages without a text layer are rasterised at 200 dpi and OCR'd (`deu+eng`)                                                                                           |
| Context   | `src/ingest/contextualize.ts` | structural `"file › section"` prefix, or one Haiku sentence per chunk (`CONTEXTUALIZE=llm`, prompt-cached document)               | stored in `chunks.context`, embedded and full-text indexed with the content; content stays verbatim                                                                                        |
| Chunker   | `src/ingest/`                 | own code                                                                                                                          | heading-aware (§ / Artikel / numbered), ~1200 chars, 150 overlap                                                                                                                           |
| Embedder  | `src/embed.ts`                | Vercel AI SDK `embedMany` + Voyage `voyage-4` (1024d, inputType query/document); OpenAI `text-embedding-3-small` optional         | `EMBED_DIM` sizes the column (migrate), `EMBED_PROVIDER=fake` for tests                                                                                                                    |
| Store     | Postgres 17                   | pgvector 0.8 (HNSW cosine), `tsvector('german')` GIN, `tenant_id`                                                                 | one DB for vectors, lexical index, metadata and permissions                                                                                                                                |
| Retrieval | `src/search.ts`               | SQL                                                                                                                               | dense (HNSW, iterative scan on pgvector ≥ 0.8), fts (OR-of-terms + `ts_rank_cd`), hybrid = RRF k=60 over top-50 each; optional RAG-fusion paraphrases (`src/expand.ts`) fused the same way |
| Reranker  | `src/rerank.ts`               | `overlap` baseline, local cross-encoder (Transformers.js), Voyage `rerank-2.5`, Cohere `rerank-v3.5`                              | off by default (`tuning.rerank`); ADR-0003 decides after `pnpm experiment rerank`                                                                                                          |
| Generator | `src/ask.ts`                  | AI SDK `generateText` + Claude                                                                                                    | German system prompt, `ANSWER_K`=10 excerpts, numbered citations, refusal when uncovered                                                                                                   |
| API       | `src/server.ts`               | `node:http`, `public/index.html`                                                                                                  | `GET /health`, `POST /search`, `POST /ask`; demo page at `/`; identity trusted from the body, auth proxy goes in front                                                                     |
| Eval      | `src/eval/`                   | own code: `run.ts` recall@k/MRR/p95, `answers.ts` generation + cost, `judge.ts` binary faithfulness judge + Cohen's κ, `stats.ts` | gates in CI on push to main; `--readme` writes the README tables                                                                                                                           |
| Tracing   | `src/telemetry.ts`            | OpenTelemetry → Langfuse (`@langfuse/otel`), AI SDK `registerTelemetry`                                                           | one trace per `pnpm ask`: ask > retrieve > embed · answer > llm; off without keys                                                                                                          |

## Data model

```
documents    (id, tenant_id, source UNIQUE per tenant, title, kind, pages, sha256, created_at)
chunks       (id, document_id → documents, tenant_id, ord, section, page, content, context,
              tsv GENERATED to_tsvector('german', context || ' ' || content), embedding vector(EMBED_DIM))
document_acl (document_id → documents, principal)      '*' | 'user:<id>' | 'group:<name>'
indexes      gin(tsv) · hnsw(embedding vector_cosine_ops) · btree(tenant_id)
RLS          documents, chunks: visible iff tenant_id = app.tenant AND an ACL row matches app.principals;
             reads run as role rag_app (APP_DATABASE_URL), writes as the owner
```

`sha256` makes ingestion idempotent: unchanged files are skipped, changed files are re-chunked atomically (delete + insert in one transaction).

## Query path

1. `search(q, mode, k, tenant, principals)` → `withCaller()` opens one transaction as `rag_app` with `app.tenant`/`app.principals` set; dense and/or fts SQL run inside it, each also carrying the tenant + ACL rule in its WHERE clause (never post-filtered in JS). With `tuning.multiQuery > 0` the question is first expanded into paraphrases and each one is searched; the lists are RRF-fused.
2. hybrid: fetch 50 candidates from each, fuse by reciprocal rank, keep top k.
3. If `tuning.rerank` is set: fetch `rerankTop` (50) candidates instead of k, rerank them (query and chunk scored together), keep top k.
4. `answer(q, hits)` → Claude with excerpts `[n]`, returns text + token usage + ms.

## What runs where

- Dev: Docker Compose Postgres on the laptop, scripts via `node --import tsx`.
- CI: GitHub Actions with a `pgvector/pgvector:pg17` service container; unit + pipeline + parser (incl. OCR) tests on every PR with fake embeddings; the eval gate only on push to `main` with the Voyage secret.
- Demo: `pnpm serve` runs the API and the one-page UI locally. Hosting (Cloudflare Worker + Hyperdrive + Neon, or one Fly.io machine with Compose) is decided in ADR-0008 when it is deployed; `@napi-rs/canvas`/tesseract.js rule out a Worker for ingestion, so ingestion stays a laptop/CI job either way.
