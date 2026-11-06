/**
 * Parsers for the messy formats (week 7). OCR tests download ~15 MB of tesseract language data on
 * first run and are skipped with SKIP_OCR=1.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { endParsers, htmlToText, parseCsv, parseFile, tableToText } from '../src/ingest/parse.js';

const F = 'test/fixtures-formats';

describe('csv', () => {
  it('detects the ; delimiter and keeps quoted commas', () => {
    const rows = parseCsv('a;b\n"x, y";1\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', '1'],
    ]);
    expect(parseCsv('a,b\r\n1,"he said ""hi"""')).toEqual([
      ['a', 'b'],
      ['1', 'he said "hi"'],
    ]);
  });
  it('repeats the header row in every block of a long table', () => {
    const rows = [['h1', 'h2'], ...Array.from({ length: 45 }, (_, i) => [`r${i}`, 'x'])];
    const blocks = tableToText(rows).split('\n\n');
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.startsWith('h1 | h2\n'))).toBe(true);
  });
  it('parses the fixture into one page of header-prefixed rows', async () => {
    const p = await parseFile(`${F}/preisliste.csv`);
    expect(p.kind).toBe('csv');
    expect(p.pages[0]).toContain('Artikel | Preis (EUR) | Allergene');
    expect(p.pages[0]).toContain('Kartoffelsalat, hausgemacht | 4,50 | Senf');
  });
});

describe('xlsx', () => {
  it('one page per sheet, formulas as results, dates as ISO', async () => {
    const p = await parseFile(`${F}/bestellungen.xlsx`);
    expect(p.kind).toBe('xlsx');
    expect(p.pages).toHaveLength(2);
    expect(p.pages[0]).toContain('Bestellungen');
    expect(p.pages[0]).toContain('2026-11-02 | Kita Sonnenschein | 120 | 420');
    expect(p.pages[1]).toContain('Kühlkette dokumentieren');
  });
});

describe('html', () => {
  it('drops script/style/nav, decodes entities, keeps table cells', async () => {
    const p = await parseFile(`${F}/speiseplan.html`);
    expect(p.kind).toBe('html');
    expect(p.pages[0]).toContain('Gemüseeintopf mit Vollkornbrötchen & Apfel');
    expect(p.pages[0]).toContain('Dienstag | Käsespätzle');
    expect(p.pages[0]).not.toContain('alert');
    expect(p.pages[0]).not.toContain('color:red');
    expect(htmlToText('a<br>b')).toBe('a\nb');
  });
});

describe.skipIf(process.env.SKIP_OCR)('ocr', () => {
  afterAll(endParsers);
  it('reads a scanned image', async () => {
    const p = await parseFile(`${F}/scan-hygiene.png`);
    expect(p.kind).toBe('image');
    expect(p.ocrPages).toBe(1);
    expect(p.pages[0]).toMatch(/Kühlkette/);
  }, 120_000);
  it('OCRs image-only PDF pages and keeps text pages as they are', async () => {
    const scan = await parseFile(`${F}/scan-hygiene.pdf`);
    expect(scan.ocrPages).toBe(1);
    expect(scan.pages[0]).toMatch(/Hygieneprotokoll/);
    const text = await parseFile('test/fixtures/muster-satzung.pdf');
    expect(text.ocrPages).toBe(0);
  }, 120_000);
});
