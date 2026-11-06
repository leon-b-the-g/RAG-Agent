# ADR-0006: Messy documents — OCR, tables, more formats, contextual chunks

Date: 2026-11-06 · Status: accepted

## Context

Week 7's goal is that a real folder from a small business ingests without a human pre-cleaning it: scanned PDFs, photos of forms, price lists in Excel, CSV exports, saved web pages. Week 1 handled PDF/DOCX/TXT with text layers only. Separately, every chunk was embedded without knowing which document or section it came from, which Anthropic's contextual-retrieval study identifies as a major source of misses (−35 % failures with context in the embedding, −49 % with context in BM25 as well, −67 % with a reranker on top).

## Decision

1. **Formats.** `parse.ts` adds `.xlsx` (one page per sheet, formulas as their results, dates as ISO), `.csv` (delimiter sniffed between `;` `,` `\t`, RFC 4180 quoting), `.html/.htm` (tags stripped, script/style/nav dropped, entities decoded, table cells joined with `|`) and images (`.png .jpg .jpeg .tif .tiff .webp .bmp`). Tables become `a | b | c` lines in blocks of 20 rows, each block repeating the header row, so a chunk of a long table still carries its column names.
2. **OCR.** A PDF page with fewer than 40 characters of text layer is rasterised at 200 dpi (`unpdf` + `@napi-rs/canvas`) and read by `tesseract.js` (`deu+eng`); images go straight to OCR. One worker per process, language data cached outside the repo, `OCR_LANG_PATH` for offline use. No Python sidecar, no cloud OCR: the whole pipeline stays `pnpm install`-able.
3. **Contextual chunks.** Every chunk gets a `context` column. Default `structural`: `"<file> › <section>"`. Optional `llm`: one Haiku-written sentence per chunk with the full document in a cached prompt prefix (≈ 1 € per million document tokens). Context is prepended for embedding and included in the generated `tsvector`; `content` stays verbatim for citations.

## Consequences

- `sql/003_context.sql` rebuilds the `tsv` generated column; existing databases migrate in place, existing chunks have `context = NULL` until re-ingested (`DELETE FROM documents` + `pnpm ingest`).
- OCR quality on bad scans is what tesseract gives; the test fixtures are clean synthetic scans. A `docs/failures/` entry is the place to record the first real OCR miss.
- Table extraction from _PDF_ pages is still the pdf.js line order (risk list, 40-risks.md); `extractTextItems` with x/y is the upgrade path when a table question fails the eval.
- `.doc`, `.pptx`, `.eml` are not parsed; they fail loudly as `unsupported file type`.
