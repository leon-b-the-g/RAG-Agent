import path from 'node:path';
import { loadGolden } from '../src/eval/run.js';
import { listFiles } from '../src/ingest/index.js';
import { parseFile } from '../src/ingest/parse.js';

/**
 * Golden-set lint: every `relevant.contains` must appear in the parsed text of its source file,
 * so a failing eval means retrieval failed, not a typo in the golden set. Needs no DB or API key.
 * Usage: pnpm golden:check [corpusDir] [goldenFile]
 */
const root = path.resolve(process.argv[2] ?? 'corpus');
const goldenFile = process.argv[3] ?? 'golden/golden.jsonl';

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
const files = await listFiles(root);
const textCache = new Map<string, Promise<string>>();
const textOf = (file: string) =>
  textCache.get(file) ??
  (textCache.set(
    file,
    parseFile(file).then((p) => fold(p.pages.join('\n'))),
  ),
  textCache.get(file)!);

const golden = await loadGolden(goldenFile);
const seen = new Set<string>();
let bad = 0;
for (const g of golden) {
  if (seen.has(g.id)) {
    console.log(`DUPLICATE  ${g.id}`);
    bad++;
  }
  seen.add(g.id);
  if (g.relevant.length === 0) {
    console.log(`ok         ${g.id} (refusal: nothing to retrieve)`);
    continue;
  }
  for (const r of g.relevant) {
    const file = files.find((f) => f.split(path.sep).join('/').endsWith(r.source));
    if (!file) {
      console.log(`NO SOURCE  ${g.id}: ${r.source} not under ${root}`);
      bad++;
      continue;
    }
    if (r.contains && !(await textOf(file)).includes(fold(r.contains))) {
      console.log(`MISSING    ${g.id}: "${r.contains}" not in ${r.source}`);
      bad++;
      continue;
    }
    console.log(`ok         ${g.id}`);
  }
}
console.log(`\n${golden.length} questions, ${bad} problems`);
process.exit(bad ? 1 : 0);
