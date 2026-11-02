export type Chunk = { ord: number; section: string | null; page: number | null; content: string };

export type ChunkOptions = { target?: number; max?: number; overlap?: number };

/** German legal/administrative headings: "§ 12 Steuersatz", "Artikel 3", "2.1 Begriffe", "Anlage 1", "A. Allgemeines" */
const HEADING =
  /^(§\s*\d+[a-z]?\b.*|Artikel\s+\d+\b.*|Anlage\s+\d+\b.*|\d{1,2}(\.\d{1,2})*\.?\s+\p{Lu}[^\n.]{2,80}|\p{Lu}\.\s+\p{Lu}[^\n]{2,80})$/u;

export function isHeading(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= 100 && HEADING.test(t);
}

/**
 * Section-aware chunking. Paragraphs never split mid-way unless they exceed `max`;
 * each chunk carries the last heading seen and the page it started on.
 */
export function chunkPages(pages: string[], opts: ChunkOptions = {}): Chunk[] {
  const target = opts.target ?? 1200;
  const max = opts.max ?? 1800;
  const overlap = opts.overlap ?? 150;

  const out: Chunk[] = [];
  let section: string | null = null;
  let buf: string[] = [];
  let bufLen = 0;
  let bufPage: number | null = null;

  const flush = () => {
    if (bufLen === 0) return;
    const content = buf.join('\n\n');
    out.push({ ord: out.length, section, page: bufPage, content });
    // keep the tail as overlap for the next chunk
    const tail = content.slice(-overlap);
    const cut = tail.indexOf(' ');
    buf = overlap > 0 && cut >= 0 ? [tail.slice(cut + 1)] : [];
    bufLen = buf.reduce((n, p) => n + p.length, 0);
    bufPage = null;
  };

  pages.forEach((pageText, i) => {
    const page = pages.length > 1 ? i + 1 : null;
    for (const para of splitParagraphs(pageText)) {
      const p = para.trim();
      if (!p) continue;
      if (isHeading(p.split('\n')[0] ?? '')) {
        flush();
        buf = [];
        bufLen = 0;
        section = p.split('\n')[0]!.trim();
      }
      for (const piece of splitLong(p, max)) {
        if (bufLen > 0 && bufLen + piece.length > target) flush();
        if (bufPage === null) bufPage = page;
        buf.push(piece);
        bufLen += piece.length;
      }
    }
  });
  flush();
  return out.filter((c) => c.content.trim().length > 0);
}

/** Paragraphs = blank-line separated blocks; a heading line always starts a new paragraph (PDFs rarely have blank lines). */
export function splitParagraphs(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    let cur: string[] = [];
    for (const line of block.split('\n')) {
      if (isHeading(line) && cur.length > 0) {
        out.push(cur.join('\n'));
        cur = [];
      }
      cur.push(line);
    }
    if (cur.length > 0) out.push(cur.join('\n'));
  }
  return out;
}

/** Split a paragraph longer than `max` at sentence ends, else hard at `max`. */
export function splitLong(p: string, max: number): string[] {
  if (p.length <= max) return [p];
  const parts: string[] = [];
  let rest = p;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const at = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('.\n'),
      window.lastIndexOf('; '),
    );
    const cut = at > max / 2 ? at + 1 : max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
