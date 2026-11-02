import { pool, query } from '../src/db.js';

/**
 * Where does the corpus say X? Prints source, page and section of every chunk containing the
 * phrase, so a golden entry can be written with the exact `contains` string and page.
 * Usage: pnpm where "Mindestlohnkommission" [--tenant=public]
 */
const args = process.argv.slice(2);
const phrase = args.filter((a) => !a.startsWith('--')).join(' ');
const tenant = args.find((a) => a.startsWith('--tenant='))?.slice(9) ?? 'public';
if (!phrase) {
  console.error('usage: pnpm where "phrase" [--tenant=public]');
  process.exit(2);
}
const rows = await query<{
  source: string;
  page: number | null;
  section: string | null;
  snippet: string;
}>(
  `SELECT d.source, c.page, c.section,
          substr(c.content, greatest(1, position(lower($1) in lower(c.content)) - 80), 240) AS snippet
     FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE c.tenant_id = $2 AND c.content ILIKE '%' || $1 || '%'
    ORDER BY d.source, c.ord
    LIMIT 30`,
  [phrase, tenant],
);
for (const r of rows) {
  console.log(`${r.source}${r.page ? `  S. ${r.page}` : ''}${r.section ? `  ${r.section}` : ''}`);
  console.log(`   …${r.snippet.replace(/\s+/g, ' ')}…\n`);
}
console.log(`${rows.length} chunk(s)`);
await pool.end();
