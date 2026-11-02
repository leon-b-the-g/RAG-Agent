import { describe, expect, it } from 'vitest';
import { chunkPages, isHeading, splitLong } from '../src/ingest/chunk.js';
import { parseFile } from '../src/ingest/parse.js';

describe('isHeading', () => {
  it('recognises German legal headings', () => {
    for (const h of [
      '§ 2 Sperrzeit',
      '§ 12a Steuersatz',
      'Artikel 3 Grundrechte',
      '2.1 Begriffe',
      'A. Allgemeines',
      'Anlage 1',
    ])
      expect(isHeading(h), h).toBe(true);
  });
  it('rejects body text', () => {
    for (const t of [
      'Die Gebühr beträgt 150 Euro.',
      '150 Euro.',
      'nach § 2 GastG',
      '',
      'x'.repeat(120),
    ])
      expect(isHeading(t), t).toBe(false);
  });
});

describe('chunkPages', () => {
  it('carries the section heading and page into each chunk', () => {
    const pages = [
      'Titel\n\n§ 1 Geltungsbereich\nDiese Satzung gilt.\n\n§ 2 Sperrzeit\nBeginnt um 5 Uhr.',
      '§ 3 Gebühren\n150 Euro.',
    ];
    const chunks = chunkPages(pages, { target: 40, max: 80, overlap: 0 });
    expect(chunks.map((c) => c.section)).toEqual([
      null,
      '§ 1 Geltungsbereich',
      '§ 2 Sperrzeit',
      '§ 3 Gebühren',
    ]);
    expect(chunks.map((c) => c.page)).toEqual([1, 1, 1, 2]);
    expect(chunks.map((c) => c.ord)).toEqual([0, 1, 2, 3]);
  });
  it('never exceeds max and keeps overlap text', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Satz ${i} enthält Inhalt.`).join(' ');
    const chunks = chunkPages([long], { target: 200, max: 300, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(300 + 40);
    expect(chunks[1]!.content.slice(0, 20)).toMatch(/Satz|enthält|Inhalt/);
  });
});

describe('splitLong', () => {
  it('splits at sentence ends', () => {
    const parts = splitLong('Erster Satz. Zweiter Satz. Dritter Satz.', 20);
    expect(parts).toEqual(['Erster Satz.', 'Zweiter Satz.', 'Dritter Satz.']);
  });
});

describe('parseFile', () => {
  it('extracts per-page German text from a PDF', async () => {
    const p = await parseFile('test/fixtures/muster-satzung.pdf');
    expect(p.kind).toBe('pdf');
    expect(p.pages).toHaveLength(2);
    expect(p.pages[0]).toContain('§ 2 Sperrzeit');
    expect(p.pages[1]).toContain('Hygienevorschriften');
  });
  it('reads txt', async () => {
    const p = await parseFile('test/fixtures/notiz.txt');
    expect(p.pages[0]).toContain('minus 18 Grad');
  });
});

describe('fuse / toOrQuery', async () => {
  const { fuse, toOrQuery, tuning } = await import('../src/search.js');
  const hit = (id: number) => ({
    id,
    source: 's',
    title: null,
    section: null,
    page: null,
    content: '',
    score: 0,
    tenant: 't',
    acl: ['*'],
  });
  it('RRF ranks an item found by both lists above an item found by one', () => {
    const out = fuse(
      [
        [hit(1), hit(2)],
        [hit(2), hit(3)],
      ],
      60,
    );
    expect(out.map((h) => h.id)).toEqual([2, 1, 3]);
    expect(out[0]!.score).toBeCloseTo(1 / 61 + 1 / 62);
  });
  it('stopword filter removes question words only when enabled', () => {
    tuning.stopwords = false;
    expect(toOrQuery('Wann beginnt die Sperrzeit?')).toBe('wann | beginnt | die | sperrzeit');
    tuning.stopwords = true;
    expect(toOrQuery('Wann beginnt die Sperrzeit?')).toBe('beginnt | die | sperrzeit');
    tuning.stopwords = false;
  });
});

describe('overlap reranker', async () => {
  const { overlapScores } = await import('../src/rerank.js');
  const hit = (id: number, content: string) => ({
    id,
    source: 's',
    title: null,
    section: null,
    page: null,
    content,
    score: 0,
    tenant: 't',
    acl: ['*'],
  });
  it('scores by share of query terms present', () => {
    const s = overlapScores('Sperrzeit für Gaststätten', [
      hit(1, 'Die Sperrzeit beginnt.'),
      hit(2, 'Sperrzeit für Gaststätten und Bars'),
      hit(3, 'nichts'),
    ]);
    expect(s[0]).toBeCloseTo(1 / 3);
    expect(s.slice(1)).toEqual([1, 0]);
  });
});

describe('stats', async () => {
  const { kappa, percentile, euros } = await import('../src/eval/stats.js');
  it("Cohen's kappa: perfect, chance, and a known case", () => {
    expect(kappa([true, false, true, false], [true, false, true, false])).toBe(1);
    expect(kappa([true, true, false, false], [true, false, true, false])).toBeCloseTo(0);
    // 20 items, 16 agreements, both raters say yes 50% of the time -> po 0.8, pe 0.5, kappa 0.6
    const a = Array.from({ length: 20 }, (_, i) => i < 10);
    const b = a.map((x, i) => (i === 0 || i === 1 || i === 10 || i === 11 ? !x : x));
    expect(kappa(a, b)).toBeCloseTo(0.6);
    expect(() => kappa([true], [])).toThrow();
  });
  it('percentile and euros', () => {
    expect(percentile([5, 1, 4, 2, 3], 0.95)).toBe(5);
    expect(percentile([], 0.95)).toBe(0);
    expect(euros({ input: 1_000_000, output: 500_000 }, { input: 3, output: 15 })).toBeCloseTo(
      10.5,
    );
  });
});

describe('judge agreement and answer summary', async () => {
  const { agreement } = await import('../src/eval/judge.js');
  const { summarize } = await import('../src/eval/answers.js');
  const v = (faithful: boolean) => ({
    answered: true,
    faithful,
    correct: null,
    unsupported: [],
    reason: '',
  });
  it('computes agreement and kappa only over labelled ids', () => {
    const verdicts = new Map([
      ['a', v(true)],
      ['b', v(false)],
      ['c', v(true)],
      ['d', v(true)],
    ]);
    const agr = agreement(verdicts, [
      { id: 'a', faithful: true },
      { id: 'b', faithful: false },
      { id: 'c', faithful: false },
      { id: 'zzz', faithful: true },
    ]);
    expect(agr).toMatchObject({ n: 3, disagreements: ['c'] });
    expect(agr!.agree).toBeCloseTo(2 / 3);
    expect(agreement(verdicts, [])).toBeNull();
  });
  it('summarizes latency, tokens and cost per query', () => {
    const row = (ms: number, tin: number, tout: number) => ({
      id: 'x',
      question: '',
      expectRefusal: false,
      answer: '',
      contexts: [],
      tokens: { input: tin, output: tout },
      ms: { retrieve: ms / 2, answer: ms / 2 },
    });
    const s = summarize([row(100, 1000, 100), row(300, 3000, 300)]);
    expect(s).toMatchObject({
      n: 2,
      avgMs: 200,
      p95Ms: 300,
      tokensPerQuery: { input: 2000, output: 200 },
    });
  });
});
