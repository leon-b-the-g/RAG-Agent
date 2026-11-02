import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractText } from 'unpdf';
import mammoth from 'mammoth';

export type Parsed = {
  kind: 'pdf' | 'docx' | 'txt';
  /** one entry per page; docx/txt have a single page */
  pages: string[];
};

export async function parseFile(file: string): Promise<Parsed> {
  const ext = path.extname(file).toLowerCase();
  const buf = await readFile(file);
  if (ext === '.pdf') {
    const { text } = await extractText(new Uint8Array(buf), { mergePages: false });
    return { kind: 'pdf', pages: text.map(normalize) };
  }
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { kind: 'docx', pages: [normalize(value)] };
  }
  if (ext === '.txt' || ext === '.md') {
    return { kind: 'txt', pages: [normalize(buf.toString('utf8'))] };
  }
  throw new Error(`unsupported file type: ${file}`);
}

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
