# ADR-0004: Permissions are enforced twice — in the query and by row-level security

Date: 2026-10-19 · Status: accepted

## Context

A retrieval system must never surface a chunk the caller may not read, and it must not do so by filtering _after_ retrieval: post-filtering leaks document existence through scores and ranks, and it silently lowers recall@k because forbidden rows occupy the top k. Two tenants with overlapping vocabulary (two restaurants, both with a Hygieneplan) is the realistic failure case.

Options considered: (a) tenant column + WHERE clause only; (b) a separate authorization service queried per chunk; (c) WHERE clause plus Postgres row-level security with a restricted database role.

## Decision

(c). Every document has one or more `document_acl` rows (`*` = everyone in the tenant, `user:<id>`, `group:<name>`). The application reads through `withCaller()`, which opens a transaction as the non-superuser role `rag_app` and sets `app.tenant` and `app.principals`; RLS policies on `documents` and `chunks` evaluate those settings. The same visibility rule is also written into every retrieval query's WHERE clause, so a connection that bypasses RLS (the owner in dev/CI without `APP_DATABASE_URL`) still filters correctly, and a future query that forgets the clause is still caught by RLS.

Principals are validated at the boundary (non-empty, no commas, because the policy reads a comma-separated setting). No caller context → `current_setting` returns NULL → zero rows: default deny.

## Consequences

- `test/leak.test.ts` runs 100 generated queries × 3 modes across two tenants and one group-restricted document and asserts zero leaks; with `APP_DATABASE_URL` set it also asserts the app role sees zero rows without a caller context. CI sets it.
- Citations carry the document's ACL (`Hit.acl`), so a UI can show why a passage is visible.
- Cost: one extra `SET`-style statement per retrieval transaction and an EXISTS subquery per row; negligible at this scale, measured by the p95 column in `pnpm eval`.
- The role password in `sql/002_acl_rls.sql` is a dev default; production sets `APP_DATABASE_URL` to a role it manages. Superusers bypass RLS by design, which is why the app must not run as one.
- Per-chunk ACLs (finer than per-document) are not supported; a document with mixed visibility is split into two documents at ingest.
