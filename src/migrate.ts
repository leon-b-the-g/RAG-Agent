import { pathToFileURL } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, query } from './db.js';

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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
