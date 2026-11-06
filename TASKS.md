# TASKS

8 weeks at ~10 h/week. Each task is 1–3 h and has an acceptance criterion. Tick as you go; move finished weeks to the bottom.

## Week 1 — Skeleton, ingestion, first search ✅ (scaffolded 2026-10-18)

- [x] Repo skeleton: README, CONTEXTS/, ADRs, CI, Docker Compose, `.env.example`
- [x] Schema: documents + chunks, pgvector HNSW, German tsvector GIN, tenant column
- [x] Parser for PDF (per page), DOCX, TXT with hyphenation and whitespace cleanup
- [x] Heading-aware chunker with section + page propagation; unit tests
- [x] Idempotent ingest (sha256), dense / fts / hybrid (RRF) search, tenant-scoped
- [x] Eval harness: recall@k, MRR, JSON results, `--gate` against thresholds
- [x] 8 seed golden questions over the week-1 laws
- [ ] Leon: `git init`, first commit, create GitHub repo `rags2riches`, push; add `OPENAI_API_KEY` as a repo secret → CI green on main
- [ ] Leon: `pnpm fetch-corpus` on the laptop (cloud session cannot reach the hosts) → `corpus/gesetze/*.pdf`, `corpus/drucksachen/*.pdf`
- [ ] Leon: `pnpm ingest` with real embeddings → note chunk count and wall time in `CONTEXTS/30-decisions.md`

## Week 2 — Golden set v1 and the first real numbers (tooling scaffolded 2026-10-18)

- [x] `pnpm golden:check`: every `contains` string must exist in the parsed source; duplicates and missing sources fail — no DB or key needed
- [x] `pnpm where "phrase"`: prints source, page and section of every chunk containing a phrase, for writing golden entries
- [x] `pnpm eval` reports p95 and lists hybrid misses; `pnpm eval --readme` writes the Numbers table into README between the markers (prettier-clean)
- [x] Tracing: OpenTelemetry → Langfuse via `src/telemetry.ts`; `search()` and `answer()` are spans, AI SDK calls nest under them; on only when `LANGFUSE_SECRET_KEY` is set
- [x] Golden set v1 drafted: 55 questions, 18 laws, kinds direct/paraphrase/hard/refusal (2026-10-19)
- [ ] Leon: `pnpm golden:check` → fix every MISSING phrase with `pnpm where "…"` (expect 5–10), delete questions that do not sound like a real small-business user, commit
- [ ] Leon: `pnpm eval --readme`; commit the table; add one line with the numbers to `CONTEXTS/30-decisions.md`
- [ ] Leon: raise `eval/thresholds.json` to 0.05 below the measured hybrid numbers (the gate now bites)
- [ ] Leon: create a Langfuse project (EU cloud free tier), put the keys in `.env`, run `pnpm ask` once — acceptance: one trace with retrieve + answer spans and token usage visible

## Week 3 — Chunking and fusion experiments (runner scaffolded 2026-10-18)

- [x] `pnpm experiment chunking`: target {600, 1200, 2000} × overlap {0, 150}, each re-ingested into tenant `exp-<t>-<o>` and evaluated in all three modes → `docs/experiments/chunking.md`
- [x] `pnpm experiment fusion`: rrfK {20, 60, 100} × candidates {25, 50, 100}, hybrid → `docs/experiments/fusion.md`
- [x] `pnpm experiment stopwords`: German question/modal-word filter off/on, fts + hybrid → `docs/experiments/stopwords.md`
- [x] `pnpm experiment efsearch`: `hnsw.ef_search` default/40/100/200, dense + hybrid, recall vs p95 → `docs/experiments/efsearch.md`
- [x] Retrieval knobs live in `tuning` (`src/search.ts`); `pnpm eval --rrf-k= --candidates= --ef-search= --stopwords --tenant=` overrides them for one run
- [ ] Leon: run the four grids with real embeddings (chunking costs ~6× one ingest in embedding calls); paste the "Best hybrid" lines into `CONTEXTS/30-decisions.md`
- [ ] Leon: set the winning values as the defaults in `tuning` and, if chunking changed, in `chunkPages` defaults; re-ingest `public`; `pnpm eval --readme`; raise thresholds
- [ ] Leon: if stopwords win, write ADR-0002 follow-up (one paragraph) saying so with the numbers

## Week 4 — Reranking and hard negatives (code scaffolded 2026-10-18)

- [x] `src/rerank.ts`: providers `none` / `overlap` (term-share baseline, no model) / `local` (Transformers.js cross-encoder, `RERANK_MODEL`) / `cohere` (AI SDK `rerank()`, `rerank-v3.5`); applied to the top `rerankTop` of any mode via `tuning.rerank`
- [x] `pnpm eval --rerank=local|cohere|overlap [--rerank-top=25]`; `pnpm experiment rerank` runs all providers it has keys/models for → `docs/experiments/rerank.md`
- [x] ADR-0003 drafted with the option table; decision blank until measured
- [ ] Leon: the draft has 9 hard negatives (`kind: hard`); add ~10 more of your own while reading (same vocabulary, different law) so the reranker has something to prove
- [ ] Leon: `pnpm experiment rerank`; try 2–3 `RERANK_MODEL` ids (first run downloads the model); if you want the Cohere row, a trial key is free
- [ ] Leon: fill ADR-0003 Decision with the numbers, set `tuning.rerank` default, `pnpm eval --readme`, raise thresholds

## Week 5 — Permissions ✅ (built 2026-10-19)

- [x] `document_acl` (document_id, principal) with `*` / `user:` / `group:` principals; `pnpm ingest --acl=…`; retrieval SQL carries tenant + ACL EXISTS in the WHERE clause
- [x] Row-level security on `documents` and `chunks` for role `rag_app`; `withCaller()` sets `app.tenant` / `app.principals` per transaction (`APP_DATABASE_URL`)
- [x] `test/leak.test.ts`: 100 queries × 3 modes, two tenants, one restricted document, zero leaks; RLS zero-rows proof; runs in CI as the restricted role
- [x] `Hit.acl` on every citation; `pnpm ask --as=user:leon,group:kitchen`; golden entries may set `principals`
- [x] ADR-0004 written
- [ ] Leon: `pnpm db:migrate` (creates the role), add `APP_DATABASE_URL` to `.env`, run `pnpm test` — expect 18 passing, 0 skipped
- [ ] Leon: re-ingest one folder with `--acl=group:kitchen` and confirm `pnpm ask` without `--as` cannot cite it

## Week 6 — Answer quality and the judge (code built 2026-10-19)

- [x] `pnpm answers`: one answer per golden question with the excerpts it saw, tokens, retrieve/answer ms → `eval/answers/latest.jsonl`; prints p95 end-to-end and €/query (`PRICE_*_PER_MTOK`)
- [x] `pnpm judge`: binary faithfulness verdict per answer (structured output: answered / faithful / correct-vs-reference / unsupported claims / reason), Cohen's κ against `eval/labels.jsonl`, `--gate`, `--readme`
- [x] `eval/labels.jsonl` template; thresholds gained a `judge` block; CI eval-gate runs answers + judge when `ANTHROPIC_API_KEY` is set
- [x] promptfoo dropped (own 80-line judge instead; decision logged)
- [ ] Leon: `pnpm answers --limit=30`, read `eval/answers/latest.jsonl`, write 30 lines into `eval/labels.jsonl` (faithful yes/no + one reason each; ~1 h)
- [ ] Leon: `pnpm judge --readme`; if κ < 0.4, tighten the system prompt in `judge.ts` once and re-run; if still < 0.4 report human labels only and say so in the README
- [ ] Leon: set `PRICE_INPUT_PER_MTOK` / `PRICE_OUTPUT_PER_MTOK` from the current Anthropic price list so the € column is real; raise the `judge` thresholds

## Week 7 — Messy documents (code built 2026-11-06, ADR-0006)

- [x] Scanned PDF pages (no text layer) rasterised at 200 dpi and OCR'd with tesseract.js (`deu+eng`); images (`png/jpg/tiff/webp/bmp`) OCR'd directly; `test/parse.test.ts` covers a synthetic scan as PNG and as image-only PDF
- [x] XLSX (one page per sheet, formula results, ISO dates), CSV (`;`/`,`/tab sniffed, quoted fields), HTML (tags stripped, entities decoded, cells joined) parsers; long tables become 20-row blocks that repeat the header
- [x] Contextual chunks: `chunks.context` (structural `file › section` default, `CONTEXTUALIZE=llm` for a prompt-cached Haiku sentence) embedded and full-text indexed with the content (`sql/003_context.sql`)
- [x] Embedding provider swap: Voyage `voyage-4` 1024d default with query/document inputType, OpenAI optional, `EMBED_DIM` enforced by migrate (ADR-0005)
- [x] Retrieval: pgvector iterative HNSW scan for filtered queries, Voyage reranker, RAG-fusion `--multi-query=n`, `ANSWER_K=10` (ADR-0007)
- [ ] Leon: `pnpm db:migrate` (adds `context`, resizes the vector column — on an existing DB run `DELETE FROM documents` first), `pnpm ingest`, `pnpm eval --readme`; paste the table into `CONTEXTS/30-decisions.md`
- [ ] Leon: `pnpm experiment rerank` and `pnpm experiment multiquery` with the Voyage + Anthropic keys; if either wins, set the `tuning` default and raise thresholds
- [ ] Leon: run `EMBED_PROVIDER=openai EMBED_DIM=1536` once into tenant `exp-openai` and compare with the Voyage row (ADR-0005 decision)
- [ ] Leon: rasterise 20 real Drucksachen pages (`pdftoppm -r 200`) into `corpus/scans/` and report recall on a 10-question scan subset
- [ ] Table-aware extraction for PDF Drucksachen (`extractTextItems` x/y → rows) — only if a table question fails the eval
- [ ] One documented retrieval failure with root cause and fix (`docs/failures/001-….md`)

## Week 8 — Ship (API + demo page built 2026-11-06)

- [x] `pnpm serve`: `node:http` API (`/health`, `/search`, `/ask`) and the one-page demo (query box, mode, tenant/principals, answer, citations with page numbers)
- [x] README architecture section matches the code; ADR-0005/0006/0007 written
- [ ] Leon: README numbers final (`pnpm eval --readme`, `pnpm judge --readme`)
- [ ] Leon: ADR-0008 hosting decision; deploy `pnpm serve` behind an auth proxy; live URL in README
- [ ] 5-minute screen recording; blog post "Measuring retrieval over German law: what moved the numbers"
- [ ] Post on LinkedIn; add to chordata-systems /projects
