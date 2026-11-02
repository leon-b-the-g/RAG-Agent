# ADR-0001: Postgres for vectors, lexical search and permissions

Date: 2026-10-18 · Status: accepted

## Context

A hybrid RAG system needs a dense index, a lexical index, document metadata and a permission filter that must be applied _inside_ retrieval (post-filtering leaks existence and wrecks recall@k). Options: a dedicated vector DB (Qdrant, Weaviate, Pinecone) plus Postgres, or Postgres with pgvector alone.

## Decision

Postgres 17 + pgvector 0.8 holds everything. Dense = HNSW cosine on `chunks.embedding`; lexical = generated `tsvector('german')` with a GIN index; permissions = `tenant_id` column in every WHERE clause (row-level security in week 5).

## Consequences

- One system to run locally, in CI and in the demo; one transaction covers document replace + chunk insert.
- Filtered HNSW search degrades when the filter is very selective; pgvector 0.8 iterative scans mitigate this, and the corpus (< 100k chunks) is far below where a dedicated engine wins.
- German stemming comes for free from `to_tsvector('german')`; compound words (Gaststättenerlaubnis) are not split, which the dense path compensates.
- Revisit if the corpus exceeds ~5M vectors or multi-vector/late-interaction retrieval is needed.
