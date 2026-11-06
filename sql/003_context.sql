-- Contextual retrieval (week 7): each chunk carries a short context prefix (document title › section,
-- or an LLM-written sentence with CONTEXTUALIZE=llm). It is embedded together with the content and
-- indexed for full-text search, but `content` stays the verbatim text shown in citations.
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS context text;

ALTER TABLE chunks DROP COLUMN IF EXISTS tsv;
ALTER TABLE chunks ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('german', coalesce(context, '') || ' ' || content)) STORED;
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);

-- Embedding width now follows EMBED_DIM (src/migrate.ts alters the column after the SQL files).
