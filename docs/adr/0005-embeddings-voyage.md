# ADR-0005: Embedding provider — Voyage `voyage-4` by default, OpenAI kept as an option

Date: 2026-11-06 · Status: accepted (unmeasured — see Consequences)

## Context

Week 1 picked OpenAI `text-embedding-3-small` (1536d) because it was the path of least resistance. The corpus is German law and the retrieval study we lean on most (Anthropic, _Contextual Retrieval_, 2024) reports Voyage and Gemini embeddings doing best; Voyage's current general-purpose line (`voyage-4`, `voyage-4-large`, `voyage-4-lite`) is explicitly trained for multilingual retrieval, exposes asymmetric `inputType` (query vs document), flexible output width (256–2048) and 200M free tokens per model, which covers this corpus many times over. The Vercel AI SDK now ships an official `@ai-sdk/voyage` provider with both embedding and reranking, so no custom HTTP client is needed.

| Option                          | Width | German/multilingual | Cost / 1M tokens  | Notes                                              |
| ------------------------------- | ----- | ------------------- | ----------------- | -------------------------------------------------- |
| OpenAI `text-embedding-3-small` | 1536  | ok                  | $0.02             | status quo, symmetric                              |
| Voyage `voyage-4`               | 1024  | optimized           | $0.06 (200M free) | asymmetric query/document, 32k context             |
| Voyage `voyage-4-large`         | 1024  | optimized           | $0.12 (200M free) | best quality, same free tier                       |
| Voyage `voyage-law-2`           | 1024  | legal               | $0.12             | domain model, 16k context, no free tokens          |
| Voyage `voyage-context-4`       | 1024  | optimized           | $0.12             | contextualized chunk embeddings, API shape differs |

## Decision

`EMBED_PROVIDER=voyage`, `EMBED_MODEL=voyage-4`, `EMBED_DIM=1024` are the defaults. Queries are embedded with `inputType: 'query'`, chunks with `'document'`. The width is configurable (`EMBED_DIM`); `pnpm db:migrate` resizes `chunks.embedding` and refuses when chunks exist, so a model swap is always an explicit re-ingest. OpenAI stays one env var away (`EMBED_PROVIDER=openai`, `EMBED_DIM=1536`).

## Consequences

- Smaller vectors (1024 vs 1536): ~33 % less index memory and faster HNSW scans.
- The decision is _not yet measured_: the eval numbers in the README are still `tbd`. Leon runs `pnpm eval --readme` with the Voyage key, then once with `EMBED_PROVIDER=openai EMBED_DIM=1536` into another tenant, and the table decides. If OpenAI wins, flip the defaults and amend this ADR.
- `voyage-law-2` and `voyage-4-large` are one `EMBED_MODEL` change each; the `chunking` experiment runner is the place to compare them.
- CI's eval gate now needs `VOYAGE_API_KEY` instead of `OPENAI_API_KEY`.
