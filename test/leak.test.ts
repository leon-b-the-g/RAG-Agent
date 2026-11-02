/**
 * Permission leak test: two tenants with identical vocabulary, one document restricted to a group.
 * 100 generated queries x 3 modes must never return a chunk the caller may not see.
 * Runs against a real Postgres; with APP_DATABASE_URL set it also proves RLS blocks a bare read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.EMBED_PROVIDER = 'fake';
const { appPool, endPools, query } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { ingestDir } = await import('../src/ingest/index.js');
const { search } = await import('../src/search.js');
type Mode = import('../src/search.js').Mode;

const haveDb = !!process.env.DATABASE_URL;
const modes: Mode[] = ['dense', 'fts', 'hybrid'];

// deterministic pseudo-random queries built from the fixtures' own vocabulary
const vocab =
  'Sperrzeit Gaststätten Gebühr Erlaubnis Lieferung Lieferdienste Hygienevorschriften Ordnungsamt Satzung Gemeinde Tiefkühlware Kühlkette Kerntemperatur Allergene Speisekarte Küchenleitung Inkrafttreten Verlängerung Gewerbebetriebe Getränke'.split(
    ' ',
  );
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const queries = Array.from({ length: 100 }, () =>
  Array.from(
    { length: 2 + Math.floor(rnd() * 2) },
    () => vocab[Math.floor(rnd() * vocab.length)],
  ).join(' '),
);

describe.skipIf(!haveDb)('permission leaks', () => {
  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM documents WHERE tenant_id IN ('leak-a', 'leak-b')");
    await ingestDir('test/fixtures', 'leak-a');
    await ingestDir('test/fixtures', 'leak-b');
    // in leak-a the Satzung is for the kitchen group only; the Notiz stays tenant-wide
    await query(
      `UPDATE document_acl SET principal = 'group:kitchen'
        WHERE document_id = (SELECT id FROM documents WHERE tenant_id = 'leak-a' AND source = 'muster-satzung.pdf')`,
    );
  });
  afterAll(() => endPools());

  it('never crosses tenants or ACLs over 100 queries x 3 modes', async () => {
    let total = 0;
    for (const q of queries)
      for (const mode of modes) {
        const anon = await search(q, mode, 10, 'leak-a');
        for (const h of anon) {
          expect(h.tenant).toBe('leak-a');
          expect(h.source, `anon caller saw restricted doc for "${q}" (${mode})`).not.toBe(
            'muster-satzung.pdf',
          );
        }
        const kitchen = await search(q, mode, 10, 'leak-a', ['group:kitchen']);
        for (const h of kitchen) expect(h.tenant).toBe('leak-a');
        const stranger = await search(q, mode, 10, 'nobody', ['group:kitchen']);
        expect(stranger).toHaveLength(0);
        total += anon.length + kitchen.length;
      }
    expect(total).toBeGreaterThan(100); // the test must actually retrieve things to mean anything
  });

  it('group member sees the restricted document, anonymous caller does not', async () => {
    const q = 'Sperrzeit Gaststätten Gebühr';
    const kitchen = await search(q, 'fts', 10, 'leak-a', ['group:kitchen']);
    expect(kitchen.some((h) => h.source === 'muster-satzung.pdf')).toBe(true);
    expect(kitchen.find((h) => h.source === 'muster-satzung.pdf')!.acl).toEqual(['group:kitchen']);
    const anon = await search(q, 'fts', 10, 'leak-a');
    expect(anon.some((h) => h.source === 'muster-satzung.pdf')).toBe(false);
  });

  it('rejects principals that could smuggle a second principal', async () => {
    await expect(search('x', 'fts', 5, 'leak-a', ['user:a,*'])).rejects.toThrow(
      /invalid principal/,
    );
  });

  it.skipIf(!process.env.APP_DATABASE_URL)(
    'RLS: the app role sees nothing without a caller context',
    async () => {
      const r = await appPool.query('SELECT count(*)::int AS n FROM chunks');
      expect(r.rows[0].n).toBe(0);
      const d = await appPool.query('SELECT count(*)::int AS n FROM documents');
      expect(d.rows[0].n).toBe(0);
    },
  );
});
