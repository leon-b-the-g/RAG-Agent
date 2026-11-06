# The retrieval bench

An animated figure of the whole pipeline drawn as one machine: a page rides the back conveyor through the scanner (parse + OCR), the blade (chunk), the stamp (context) and the hood (embed) into the filing cabinet (Postgres, one drawer per tenant, the lock is row-level security); on the front rails the query carriage dips a round probe (dense) and a comb (full text) into the open drawer, the dial fuses the two lists (RRF k = 60), the gate lifts and the answer card rises with its citation tabs; the gauge at the left reads recall@10 against the golden set.

Every number in the readout is the pipeline's real default (`MODEL` at the top of `build.mjs`).

```bash
node build.mjs             # retrieval-bench.html (dark)
node build.mjs --light     # retrieval-bench-light.html
node build.mjs --artifact  # + retrieval-bench.artifact.html, a fragment that follows the host's theme
```

Hover to scrub the tour, arrow keys step the eight phases (parse, chunk, context, embed, store, search, answer, eval); it goes still under `prefers-reduced-motion`.

Built with the anatomy drawing kit (`kit/`, MIT); the figure itself is this repo's.
