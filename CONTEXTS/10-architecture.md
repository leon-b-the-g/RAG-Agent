# 10 — Architecture

## Components

| Component | Where              | Tech                                                                                                                              | Notes                                                                             |
| --------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Parser    | `src/ingest/`      | unpdf (pdf.js), mammoth                                                                                                           | per-page text; OCR for scans is week 7 (tesseract.js, Node, no Python)            |
| Chunker   | `src/ingest/`      | own code                                                                                                                          | heading-aware (§ / Artikel / numbered), ~1200 chars, 150 overlap                  |
| Embedder  | `src/embed.ts`     | Vercel AI SDK `embedMany` + OpenAI `text-embedding-3-small` (1536d)                                                               | `EMBED_PROVIDER=fake` for tests                                                   |
| Store     | Postgres 17        | pgvector 0.8 (HNSW cosine), `tsvector('german')` GIN, `tenant_id`                                                                 | one DB for vectors, lexical index, metadata and permissions                       |
| Retrieval | `src/search.ts`    | SQL                                                                                                                               | dense, fts (OR-of-terms + `ts_rank_cd`), hybrid = RRF k=60 over top-50 each       |
| Reranker  | `src/rerank.ts`    | `overlap` baseline, local cross-encoder (Transformers.js), Cohere `rerank()`                                                      | off by default (`tuning.rerank`); ADR-0003 decides after `pnpm experiment rerank` |
| Generator | `src/ask.ts`       | AI SDK `generateText` + Claude                                                                                                    | German system prompt, numbered citations, refusal when uncovered                  |
| Eval      | `src/eval/`        | own code: `run.ts` recall@k/MRR/p95, `answers.ts` generation + cost, `judge.ts` binary faithfulness judge + Cohen's κ, `stats.ts` | gates in CI on push to main; `--readme` writes the README tables                  |
| Tracing   | `src/telemetry.ts` | OpenTelemetry → Langfuse (`@langfuse/otel`), AI SDK `registerTelemetry`                                                           | one trace per `pnpm ask`: ask > retrieve > embed · answer > llm; off without keys |

## Data model

```
documents    (id, tenant_id, source UNIQUE per tenant, title, kind, pages, sha256, created_at)
chunks       (id, document_id → documents, tenant_id, ord, section, page, content,
              tsv GENERATED to_tsvector('german', content), embedding vector(1536))
document_acl (document_id → documents, principal)      '*' | 'user:<id>' | 'group:<name>'
indexes      gin(tsv) · hnsw(embedding vector_cosine_ops) · btree(tenant_id)
RLS          documents, chunks: visible iff tenant_id = app.tenant AND an ACL row matches app.principals;
             reads run as role rag_app (APP_DATABASE_URL), writes as the owner
```

`sha256` makes ingestion idempotent: unchanged files are skipped, changed files are re-chunked atomically (delete + insert in one transaction).

## Query path

1. `search(q, mode, k, tenant, principals)` → `withCaller()` opens one transaction as `rag_app` with `app.tenant`/`app.principals` set; dense and/or fts SQL run inside it, each also carrying the tenant + ACL rule in its WHERE clause (never post-filtered in JS).
2. hybrid: fetch 50 candidates from each, fuse by reciprocal rank, keep top k.
3. If `tuning.rerank` is set: fetch `rerankTop` (50) candidates instead of k, rerank them (query and chunk scored together), keep top k.
4. `answer(q, hits)` → Claude with excerpts `[n]`, returns text + token usage + ms.

## What runs where

- Dev: Docker Compose Postgres on the laptop, scripts via `node --import tsx`.
- CI: GitHub Actions with a `pgvector/pgvector:pg17` service container; unit + pipeline tests on every PR with fake embeddings; the eval gate only on push to `main` with the OpenAI secret.
- Demo (week 8): Cloudflare Worker + Hyperdrive to a managed Postgres (Neon free tier), or a single Fly.io machine with Docker Compose. Decided in ADR-0005 when the demo is built.
