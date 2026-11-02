CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id          bigserial PRIMARY KEY,
  tenant_id   text NOT NULL DEFAULT 'public',
  source      text NOT NULL,                 -- file path relative to corpus/ or a URL
  title       text,
  kind        text NOT NULL,                 -- pdf | docx | txt
  pages       int,
  sha256      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source)
);

CREATE TABLE IF NOT EXISTS chunks (
  id           bigserial PRIMARY KEY,
  document_id  bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id    text NOT NULL,
  ord          int NOT NULL,
  section      text,
  page         int,
  content      text NOT NULL,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('german', content)) STORED,
  embedding    vector(1536),
  UNIQUE (document_id, ord)
);

CREATE INDEX IF NOT EXISTS chunks_tsv_idx       ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_tenant_idx    ON chunks (tenant_id);
