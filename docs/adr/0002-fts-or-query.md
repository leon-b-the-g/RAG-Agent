# ADR-0002: Full-text queries are OR-of-terms ranked by ts_rank_cd

Date: 2026-10-18 · Status: accepted

## Context

`websearch_to_tsquery('german', 'Wann beginnt die Sperrzeit für Gaststätten?')` becomes `'wann' & 'beginnt' & 'sperrzeit' & 'gaststatt'`. Question words like "wann" are not German stopwords in Postgres, so natural questions matched nothing in the pipeline test.

## Decision

Tokenise the question in TypeScript (letters/digits, length ≥ 2, de-duplicated), join with `|`, and pass to `to_tsquery('german', …)`. `ts_rank_cd` ranks chunks that match more terms, more densely, higher.

## Consequences

- Recall-oriented: any term can match; precision comes from ranking and from fusion with the dense path.
- Phrase queries are not supported in fts mode; dense mode covers paraphrases.
- Stopword handling is left to the `german` dictionary; a custom stopword list (wann, wie, welche, …) is a candidate week-3 experiment, measured with `pnpm eval`.
