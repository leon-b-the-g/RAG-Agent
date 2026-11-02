/**
 * End-to-end against a real Postgres (needs DATABASE_URL; CI provides a pgvector service).
 * Uses EMBED_PROVIDER=fake so no API key is required.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.EMBED_PROVIDER = 'fake';
const { pool, query } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { ingestDir } = await import('../src/ingest/index.js');
const { search } = await import('../src/search.js');
const { evaluate, score } = await import('../src/eval/run.js');

const haveDb = !!process.env.DATABASE_URL;

describe.skipIf(!haveDb)('pipeline', () => {
  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM documents WHERE tenant_id IN ('test', 'other')");
    await ingestDir('test/fixtures', 'test');
    await ingestDir('test/fixtures', 'other');
  });
  afterAll(() => pool.end());

  it('ingests both fixtures with page-aware chunks', async () => {
    const rows = await query<{ source: string; n: string; pages: number }>(
      `SELECT d.source, count(c.*) AS n, d.pages FROM documents d JOIN chunks c ON c.document_id = d.id
        WHERE d.tenant_id = 'test' GROUP BY d.source, d.pages ORDER BY d.source`,
    );
    expect(rows.map((r) => r.source)).toEqual(['muster-satzung.pdf', 'notiz.txt']);
    expect(rows[0]!.pages).toBe(2);
  });

  it('full-text search finds the Sperrzeit paragraph with German stemming', async () => {
    const hits = await search('Wann beginnt die Sperrzeit für Gaststätten?', 'fts', 5, 'test');
    expect(hits[0]!.content).toContain('Sperrzeit');
    expect(hits[0]!.section).toBe('§ 2 Sperrzeit');
  });

  it('hybrid returns fused results and is tenant-scoped', async () => {
    const hits = await search('Kühlkette Tiefkühlware', 'hybrid', 5, 'test');
    expect(hits[0]!.source).toBe('notiz.txt');
    const other = await search('Kühlkette Tiefkühlware', 'hybrid', 5, 'other');
    expect(other.every((h) => h.source === 'notiz.txt' || h.source === 'muster-satzung.pdf')).toBe(
      true,
    );
    const none = await search('Kühlkette Tiefkühlware', 'hybrid', 5, 'nobody');
    expect(none).toHaveLength(0);
  });

  it('eval scores recall and MRR against a golden entry', async () => {
    const g = {
      id: 'g1',
      question: 'Gebühr für die Erlaubnis',
      relevant: [{ source: 'muster-satzung.pdf', contains: '150 Euro' }],
      tenant: 'test',
    };
    const hits = await search(g.question, 'fts', 10, 'test');
    expect(score(hits, g).recall).toBe(1);
    const m = await evaluate([g], 'hybrid', 10);
    expect(m.n).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.mrr).toBeGreaterThan(0);
  });
});
