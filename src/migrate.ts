import { pathToFileURL } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, query } from './db.js';
import { DIM } from './embed.js';

export async function migrate(dir = path.resolve('sql')) {
  await query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  const applied = new Set(
    (await query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = await readFile(path.join(dir, f), 'utf8');
    await query(sql);
    await query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    console.log(`applied ${f}`);
  }
  await resizeEmbedding();
}

/**
 * chunks.embedding must be exactly as wide as the configured model. A width change on a non-empty
 * table fails on purpose: the vectors would be garbage, delete the chunks (re-ingest) first.
 */
async function resizeEmbedding() {
  const [col] = await query<{ dim: number }>(
    `SELECT atttypmod AS dim FROM pg_attribute
      WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'`,
  );
  if (col?.dim === DIM) return;
  const n = (await query<{ n: string }>('SELECT count(*) AS n FROM chunks'))[0]?.n ?? '0';
  if (Number(n) > 0)
    throw new Error(
      `chunks.embedding is vector(${col?.dim}) but EMBED_DIM=${DIM}; delete the ${n} chunks (DELETE FROM documents) and re-ingest`,
    );
  await query(`ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(${DIM})`); // DIM is a number we own
  console.log(`embedding column resized to vector(${DIM})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
