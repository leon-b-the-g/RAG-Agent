import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pool, query, withTx, vec } from '../db.js';
import { embed } from '../embed.js';
import { chunkPages, type ChunkOptions } from './chunk.js';
import { contextualize } from './contextualize.js';
import { endParsers, EXT, parseFile } from './parse.js';

export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await listFiles(p)));
    else if (EXT.has(path.extname(name).toLowerCase())) out.push(p);
  }
  return out.sort();
}

export async function ingestFile(
  file: string,
  root: string,
  tenant: string,
  chunkOpts: ChunkOptions = {},
  acl: string[] = ['*'],
): Promise<'skipped' | number> {
  const source = path.relative(root, file).split(path.sep).join('/');
  const sha256 = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  const existing = await query<{ id: number; sha256: string }>(
    'SELECT id, sha256 FROM documents WHERE tenant_id = $1 AND source = $2',
    [tenant, source],
  );
  if (existing[0]?.sha256 === sha256) return 'skipped';

  const parsed = await parseFile(file);
  if (parsed.ocrPages) console.log(`      ocr    ${parsed.ocrPages} page(s) of ${source}`);
  const chunks = chunkPages(parsed.pages, chunkOpts);
  const title = path.basename(file);
  const contexts = await contextualize(title, parsed.pages, chunks);
  // context is embedded and indexed with the text, but content stays verbatim for citations
  const embeddings = await embed(chunks.map((c, i) => `${contexts[i]}\n\n${c.content}`));

  await withTx(async (c) => {
    if (existing[0]) await c.query('DELETE FROM documents WHERE id = $1', [existing[0].id]);
    const doc = await c.query<{ id: number }>(
      `INSERT INTO documents (tenant_id, source, title, kind, pages, sha256)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenant, source, title, parsed.kind, parsed.pages.length, sha256],
    );
    const docId = doc.rows[0]!.id;
    for (const principal of acl)
      await c.query('INSERT INTO document_acl (document_id, principal) VALUES ($1, $2)', [
        docId,
        principal,
      ]);
    for (const [i, ch] of chunks.entries()) {
      await c.query(
        `INSERT INTO chunks (document_id, tenant_id, ord, section, page, content, context, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
        [docId, tenant, ch.ord, ch.section, ch.page, ch.content, contexts[i], vec(embeddings[i]!)],
      );
    }
  });
  return chunks.length;
}

export async function ingestDir(
  root: string,
  tenant = 'public',
  chunkOpts: ChunkOptions = {},
  acl: string[] = ['*'],
) {
  const files = await listFiles(root);
  let total = 0;
  for (const f of files) {
    try {
      const r = await ingestFile(f, root, tenant, chunkOpts, acl);
      console.log(
        `${r === 'skipped' ? 'skip ' : `${String(r).padStart(4)} chunks`}  ${path.relative(root, f)}`,
      );
      if (r !== 'skipped') total += r;
    } catch (e) {
      console.error(`FAILED ${f}: ${(e as Error).message}`);
    }
  }
  console.log(`\n${files.length} files, ${total} new chunks`);
  await endParsers();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'corpus');
  const flag = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const tenant = flag('tenant') ?? 'public';
  const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
  const chunkOpts = {
    target: num(flag('target')),
    overlap: num(flag('overlap')),
    max: num(flag('max')),
  };
  const acl = flag('acl')?.split(',') ?? ['*']; // e.g. --acl=group:kitchen,user:leon
  ingestDir(root, tenant, chunkOpts, acl)
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
