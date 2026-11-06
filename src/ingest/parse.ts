import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

export type Parsed = {
  kind: 'pdf' | 'docx' | 'txt' | 'xlsx' | 'csv' | 'html' | 'image';
  /** one entry per page; docx/txt/html/image have a single page, xlsx one per sheet */
  pages: string[];
  /** pages that came out of OCR (scanned PDF pages, images) */
  ocrPages: number;
};

export const EXT = new Set([
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.xlsx',
  '.csv',
  '.html',
  '.htm',
  '.png',
  '.jpg',
  '.jpeg',
  '.tif',
  '.tiff',
  '.webp',
  '.bmp',
]);

/** A PDF page with fewer characters than this is treated as a scan and OCR'd. */
const SCAN_THRESHOLD = 40;
/** 200 dpi: tesseract's sweet spot for body text; pdf.js scale 1 = 72 dpi. */
const OCR_SCALE = 200 / 72;

export async function parseFile(file: string): Promise<Parsed> {
  const ext = path.extname(file).toLowerCase();
  const buf = await readFile(file);
  if (ext === '.pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    let ocrPages = 0;
    const pages: string[] = [];
    for (const [i, t] of text.entries()) {
      if (t.trim().length >= SCAN_THRESHOLD) {
        pages.push(normalize(t));
        continue;
      }
      const png = await renderPageAsImage(pdf, i + 1, {
        canvasImport: () => import('@napi-rs/canvas'),
        scale: OCR_SCALE,
      });
      pages.push(normalize(await ocr(Buffer.from(png))));
      ocrPages++;
    }
    return { kind: 'pdf', pages, ocrPages };
  }
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { kind: 'docx', pages: [normalize(value)], ocrPages: 0 };
  }
  if (ext === '.txt' || ext === '.md')
    return { kind: 'txt', pages: [normalize(buf.toString('utf8'))], ocrPages: 0 };
  if (ext === '.html' || ext === '.htm')
    return { kind: 'html', pages: [normalize(htmlToText(buf.toString('utf8')))], ocrPages: 0 };
  if (ext === '.csv') {
    const rows = parseCsv(buf.toString('utf8'));
    return { kind: 'csv', pages: [tableToText(rows)], ocrPages: 0 };
  }
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const pages = wb.worksheets.map((ws) => {
      const rows: string[][] = [];
      ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map(cellText)));
      return `${ws.name}\n\n${tableToText(rows)}`;
    });
    return { kind: 'xlsx', pages, ocrPages: 0 };
  }
  if (EXT.has(ext)) return { kind: 'image', pages: [normalize(await ocr(buf))], ocrPages: 1 };
  throw new Error(`unsupported file type: ${file}`);
}

// One tesseract worker per process, created on first scanned page (first run downloads ~15 MB of language data).
let worker: Promise<import('tesseract.js').Worker> | undefined;
async function ocr(image: Buffer): Promise<string> {
  await mkdir(process.env.OCR_CACHE ?? path.join(tmpdir(), 'tesseract'), { recursive: true });
  worker ??= import('tesseract.js').then((t) =>
    t.createWorker(process.env.OCR_LANGS ?? 'deu+eng', undefined, {
      cachePath: process.env.OCR_CACHE ?? path.join(tmpdir(), 'tesseract'), // downloaded language data, not the repo root
      // offline / air-gapped: a folder with <lang>.traineddata (e.g. a system tesseract's tessdata dir) instead of the CDN
      ...(process.env.OCR_LANG_PATH && { langPath: process.env.OCR_LANG_PATH, gzip: false }),
    }),
  );
  const { data } = await (await worker).recognize(image as unknown as string); // tesseract.js accepts a Buffer in Node; its types list browser inputs only
  return data.text;
}

/** Call before process exit, otherwise the OCR worker thread keeps the process alive. */
export const endParsers = async () => {
  if (worker) await (await worker).terminate();
  worker = undefined;
};

/** Collapse PDF extraction noise: hyphenation at line ends, runs of spaces, >2 blank lines. */
export function normalize(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2') // Wort-\ntrennung -> Worttrennung
    .replace(/[ \t]+/g, ' ')
    .replace(/ \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Rows become "a | b | c" lines in blocks of ROWS_PER_BLOCK, each block repeating the header row,
 * so every chunk of a long table still says what its columns mean.
 */
const ROWS_PER_BLOCK = 20;
export function tableToText(rows: string[][]): string {
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return '';
  const line = (r: string[]) => r.map((c) => c.trim()).join(' | ');
  if (body.length === 0) return line(header);
  const blocks: string[] = [];
  for (let i = 0; i < body.length; i += ROWS_PER_BLOCK)
    blocks.push([header, ...body.slice(i, i + ROWS_PER_BLOCK)].map(line).join('\n'));
  return blocks.join('\n\n');
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: string; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if ('result' in o) return cellText(o.result);
    if (o.text !== undefined) return o.text;
  }
  return String(v);
}

/** RFC 4180 fields with quotes; delimiter is whichever of ; , \t the header uses most (German exports use ;). */
export function parseCsv(text: string): string[][] {
  const head = text.split('\n')[0] ?? '';
  const delim = [';', ',', '\t'].sort((a, b) => head.split(b).length - head.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') ((field += '"'), i++);
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) (row.push(field), (field = ''));
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  return rows;
}

// shortcut: regex tag stripping, no DOM — fine for exported pages and wikis; switch to a parser if tables/nav matter
export function htmlToText(html: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    auml: 'ä',
    ouml: 'ö',
    uuml: 'ü',
    Auml: 'Ä',
    Ouml: 'Ö',
    Uuml: 'Ü',
    szlig: 'ß',
    euro: '€',
  };
  return html
    .replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre)>/gi, '\n\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t\n]*\|[ \t\n]*/g, ' | ') // pretty-printed HTML puts cells on their own lines
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, e) => entities[e] ?? m);
}
