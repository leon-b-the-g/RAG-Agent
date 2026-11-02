# CLAUDE.md — working rules for this repo

Read `CONTEXTS/00-overview.md` first, then `TASKS.md` for what is next.

## Commands

- `pnpm db:up && pnpm db:migrate` — Postgres 17 + pgvector via Docker, apply `sql/*.sql` in order
- `pnpm test` — vitest; pipeline tests need `DATABASE_URL` and run with `EMBED_PROVIDER=fake`
- `pnpm typecheck`, `pnpm format` — must be clean before any commit
- `pnpm ingest [dir] [--tenant=x]`, `pnpm ask "…" [--mode=dense|fts|hybrid]`, `pnpm eval [--gate] [--k=10]`

## Conventions

- TypeScript strict, ESM, Node ≥ 22.9. No ORM: plain SQL through `src/db.ts` `query()`; migrations are numbered files in `sql/`.
- One module per concern: `ingest/parse.ts` (file → pages), `ingest/chunk.ts` (pages → chunks), `embed.ts`, `search.ts` (dense / fts / hybrid), `ask.ts` (generation), `eval/run.ts` (metrics + gate).
- Every retrieval change gets measured: run `pnpm eval` before and after, paste both tables into the PR or commit message, and append a line to `CONTEXTS/30-decisions.md` if a default changes.
- Fake embeddings (`EMBED_PROVIDER=fake`) are for plumbing tests only; never report numbers from them.
- Never commit `corpus/`, `.env`, or `eval/results/`.
- Comments explain _why_ only. Shortcuts carry a `shortcut: <limit>, <when to upgrade>` comment.

## Do not touch

- `golden/golden.jsonl` is model-drafted, human-verified: the 2026-10-19 draft was written from knowledge of the statutes without reading the corpus, then checked line by line by Leon (`pnpm golden:check`, `pnpm where`). From here on, do not add or edit golden questions with a model; propose candidates in a PR comment and let Leon verify them against the documents.
- `eval/thresholds.json` only moves up, by a human, after a measured improvement.
- `eval/labels.jsonl` is hand-written by Leon, like the golden set. Never let the judge model write or edit labels; κ is only meaningful against independent human labels.
