-- Per-document access control + row-level security (week 5).
-- principal: '*' (everyone in the tenant) | 'user:<id>' | 'group:<name>'
CREATE TABLE IF NOT EXISTS document_acl (
  document_id  bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  principal    text   NOT NULL CHECK (principal <> '' AND position(',' IN principal) = 0),
  PRIMARY KEY (document_id, principal)
);
INSERT INTO document_acl (document_id, principal) SELECT id, '*' FROM documents ON CONFLICT DO NOTHING;

-- The application reads as rag_app; migrate/ingest keep using the owner. Password is a dev default,
-- override APP_DATABASE_URL in production. Superusers bypass RLS, which is why the app must not be one.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rag_app') THEN
    CREATE ROLE rag_app LOGIN PASSWORD 'rag_app';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO rag_app;
GRANT SELECT ON documents, chunks, document_acl TO rag_app;

-- A query sees a row only when the transaction has set app.tenant and app.principals (comma-separated)
-- via set_config(..., true); unset => current_setting returns NULL => policy false => zero rows.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_caller ON documents;
CREATE POLICY documents_caller ON documents FOR SELECT TO rag_app USING (
  tenant_id = current_setting('app.tenant', true)
  AND EXISTS (SELECT 1 FROM document_acl a WHERE a.document_id = documents.id
                 AND a.principal = ANY (string_to_array(current_setting('app.principals', true), ',')))
);
DROP POLICY IF EXISTS chunks_caller ON chunks;
CREATE POLICY chunks_caller ON chunks FOR SELECT TO rag_app USING (
  tenant_id = current_setting('app.tenant', true)
  AND EXISTS (SELECT 1 FROM document_acl a WHERE a.document_id = chunks.document_id
                 AND a.principal = ANY (string_to_array(current_setting('app.principals', true), ',')))
);
