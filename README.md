# rags2riches

A retrieval-augmented question answering system for German legal and regulatory documents that can prove its own quality: hybrid search (pgvector + Postgres full-text + optional reranking) over contextualised chunks, ingestion of messy inputs (scanned PDFs, images, Excel, CSV, HTML, DOCX), per-document permissions enforced by row-level security, a hand-verified golden set, and a CI gate that fails when recall, MRR or answer faithfulness drops.

All data is public law or synthetic; the repo contains no company or personal data.

**Problem.** Most "chat with your documents" demos cannot say how good their retrieval is. This repo can: every change to chunking, indexing, fusion or reranking is measured against a hand-written golden set, and CI fails if recall@10 or MRR drops below `eval/thresholds.json`.

**Key decision.** Postgres does everything (pgvector for dense, `tsvector('german')` for lexical, row filter for permissions) instead of a separate vector database. One system to run, one query planner, one backup. See [ADR-0001](docs/adr/0001-postgres-only.md).

## Numbers

<!-- eval:start -->

| Retrieval mode | recall@10 | MRR | avg ms | p95 ms |
| -------------- | --------- | --- | ------ | ------ |
| dense          | tbd       | tbd | tbd    | tbd    |
| full-text      | tbd       | tbd | tbd    | tbd    |
| hybrid (RRF)   | tbd       | tbd | tbd    | tbd    |

_Filled in by `pnpm eval --readme` once the corpus is ingested with real embeddings._
<!-- eval:end -->

Answer quality (generation + judge):

<!-- judge:start -->

| Measure                  | Value                                              |
| ------------------------ | -------------------------------------------------- |
| Faithful answers (judge) | tbd                                                |
| Judge vs human labels    | tbd — the judge is not trusted until κ is reported |
| End-to-end latency       | tbd                                                |
| Cost per query           | tbd                                                |

_Filled in by `pnpm answers && pnpm judge --readme` once the corpus and the human labels exist._
<!-- judge:end -->

Reproduce: `pnpm eval` (golden set in `golden/golden.jsonl`, results land in `eval/results/`). `pnpm golden:check` verifies every golden passage exists in the parsed corpus; `pnpm where "phrase"` shows where the corpus says something, with page and section, for writing new golden entries.

## Run it

```bash
cp .env.example .env            # add VOYAGE_API_KEY and ANTHROPIC_API_KEY
pnpm install
pnpm db:up                      # Postgres 17 + pgvector in Docker
pnpm db:migrate                 # schema, RLS role, context column; sizes the vector column to EMBED_DIM
pnpm fetch-corpus               # ~18 German laws + ~40 Bundestag Drucksachen into corpus/
pnpm ingest                     # parse (+OCR) -> chunk -> contextualise -> embed -> Postgres (idempotent, sha256-keyed)
pnpm ask "Wie hoch ist der ermäßigte Umsatzsteuersatz?"          # add --as=user:x,group:y for restricted docs
pnpm serve                      # http://localhost:3000 — demo page, POST /ask, POST /search, GET /health
pnpm eval                       # recall@10 / MRR for dense, fts, hybrid  (--rerank=voyage --multi-query=2 to try the extras)
pnpm test                       # unit + parser + pipeline tests (EMBED_PROVIDER=fake, no API key needed)
pnpm golden:check               # lint the golden set against the parsed corpus
pnpm where "Mindestlohnkommission"   # find where the corpus says something (source, page, section)
pnpm experiment fusion          # grids: chunking | fusion | stopwords | efsearch | rerank | multiquery -> docs/experiments/*.md
pnpm answers                    # generate an answer per golden question (Anthropic key) -> eval/answers/latest.jsonl
pnpm judge --readme             # faithfulness judge + Cohen's kappa vs eval/labels.jsonl; writes the README table
```

Any folder of `.pdf` (text or scanned), `.docx`, `.xlsx`, `.csv`, `.html`, `.txt`, `.md`, `.png/.jpg/.tiff/.webp` works: `pnpm ingest path/to/folder --tenant=acme --acl=group:kitchen`.

## How it works

```
corpus/*.pdf|docx|xlsx|csv|html|txt|png|jpg
   │  parse (unpdf / mammoth / exceljs / own csv+html)   per page or sheet; pages without a text layer
   │                                                      are rasterised at 200 dpi and OCR'd (tesseract.js, deu+eng)
   ▼
chunkPages()                          section-aware: "§ 12 …", "Artikel 3", "2.1 …" start a chunk; ~1200 chars, 150 overlap;
                                      tables arrive as 20-row blocks that each repeat the header row
   ▼
contextualize()                       "file › section" prefix (or one Haiku sentence per chunk, CONTEXTUALIZE=llm)
   ▼
embed()  ──► chunks(content, context, embedding vector(1024, voyage-4), tsv tsvector 'german' over context+content, tenant_id, section, page)
   │
   ▼  query  (optionally the question + 2 model-written paraphrases, fused the same way)
dense  : ORDER BY embedding <=> q            (HNSW cosine, iterative scan so tenant/ACL filters still return k)
fts    : tsv @@ to_tsquery('german', t1|t2…) ranked by ts_rank_cd
hybrid : reciprocal rank fusion of both, k=60
rerank : optional cross-encoder over the top 50 (Voyage rerank-2.5, Cohere, local Transformers.js, or a term-overlap baseline)
   ▼
ask    : Claude answers in German from the top 10 excerpts, cites [n], refuses when the excerpts do not cover the question
serve  : the same two steps behind POST /ask, plus a one-page UI
```

Tracing: with Langfuse keys in `.env`, every `pnpm ask` produces one trace (retrieve → embed, answer → model call) with latency and token usage; without keys tracing is a no-op.

Permissions: every document has ACL rows (`*` = everyone in the tenant, `user:<id>`, `group:<name>`; set at ingest with `--acl=group:kitchen,user:leon`). A retrieval runs as a caller (`pnpm ask "…" --as=user:leon,group:kitchen`) inside one transaction on a restricted Postgres role with `app.tenant` / `app.principals` set, and row-level security policies decide what exists; the same rule is repeated in each query's WHERE clause as a second line of defence. `test/leak.test.ts` fires 100 generated queries × 3 modes across two tenants with identical vocabulary and one group-restricted document and asserts zero leaks. Every citation carries the document's ACL. Design: [ADR-0004](docs/adr/0004-permissions.md).

## Evaluation

`golden/golden.jsonl` holds one question per line with the passage that must be retrieved (`source` + `contains` substring or `page`). `pnpm eval` reports recall@k and MRR per mode; `pnpm eval --gate` exits non-zero below the thresholds, which is what the `eval-gate` CI job runs on every push to `main`.

The golden set is written by hand while reading the documents. That is the point: a synthetic question set generated by the same model that answers tells you nothing.

Answer quality is judged, not assumed: `pnpm answers` generates an answer per golden question with the excerpts it saw; `pnpm judge` asks a second model one binary question per answer — is every claim supported by those excerpts? — and compares its verdicts with hand-written labels in `eval/labels.jsonl` (Cohen's κ). A judge with κ below 0.4 is reported as untrusted and its numbers are not used; `pnpm judge --gate` fails below `eval/thresholds.json`.

## Experiments

`pnpm experiment <chunking|fusion|stopwords|efsearch|rerank>` runs a parameter grid against the golden set and appends a dated results table to `docs/experiments/<name>.md`. Defaults in `tuning` (`src/search.ts`) and `chunkPages` only move after a grid shows a gain, and the before/after tables stay in the repo.

## Status

Code for weeks 1–8 is in place; the numbers wait for API keys (see the Leon items in [`TASKS.md`](TASKS.md)). Design intent and decisions live in [`CONTEXTS/`](CONTEXTS/00-overview.md) and [`docs/adr/`](docs/adr/).

## Data

- Corpus: public German federal law and Bundestag papers (gesetze-im-internet.de, dserver.bundestag.de), fetched by `pnpm fetch-corpus`, not redistributed here.
- Test fixtures (`test/fixtures/`, `test/fixtures-formats/`): synthetic documents written for the tests (a fictional municipal Satzung, a kitchen memo, an invented price list, order sheet, menu page and a rendered "scan" of a hygiene protocol).
- Tenants, ACL principals, user ids: fictional (`leak-a`, `group:kitchen`, `user:leon`).
- Golden set and labels: written for this project; questions are the kind a small-business user would ask, not real user queries.

## Licence

MIT.
