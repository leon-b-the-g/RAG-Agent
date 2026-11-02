import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { generateText, Output } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { span } from '../telemetry.js';
import { type Answered, summarize } from './answers.js';
import { kappa } from './stats.js';

/**
 * Faithfulness judge: is every claim in the answer supported by the excerpts the model saw?
 * Binary on purpose (Hamel Husain / Eugene Yan): a 1-5 scale hides disagreement; a yes/no can be
 * checked against human labels with Cohen's kappa, which is what decides whether the judge is trusted.
 * Usage: pnpm judge [--answers=eval/answers/latest.jsonl] [--labels=eval/labels.jsonl] [--gate] [--readme]
 */
const modelId = process.env.JUDGE_MODEL ?? process.env.ANSWER_MODEL ?? 'claude-sonnet-5-5';

export const Verdict = z.object({
  answered: z.boolean().describe('false if the answer says the excerpts do not cover the question'),
  faithful: z
    .boolean()
    .describe(
      'true only if every factual claim is supported by the excerpts; a refusal counts as faithful',
    ),
  correct: z
    .boolean()
    .nullable()
    .describe('when an expected answer is given: does the answer agree with it; otherwise null'),
  unsupported: z
    .array(z.string())
    .describe('claims not supported by the excerpts, verbatim, max 5'),
  reason: z.string().describe('one sentence'),
});
export type Verdict = z.infer<typeof Verdict>;

export async function judgeOne(a: Answered): Promise<Verdict> {
  const excerpts = a.contexts
    .map((c, i) => `[${i + 1}] ${c.source}${c.page ? ` S. ${c.page}` : ''}\n${c.content}`)
    .join('\n\n');
  const res = await span('judge', { id: a.id, model: modelId }, () =>
    generateText({
      model: anthropic(modelId as 'claude-sonnet-5-5'),
      output: Output.object({ schema: Verdict }),
      system:
        'Du prüfst streng, ob eine Antwort ausschließlich durch die gegebenen Auszüge gedeckt ist. ' +
        'Jede Tatsachenbehauptung, Zahl oder Frist muss wörtlich oder sinngemäß in einem Auszug stehen. ' +
        'Allgemeinwissen zählt nicht als Beleg. Eine ehrliche Verweigerung ("die Auszüge beantworten das nicht") ist treu.',
      prompt:
        `Frage: ${a.question}\n\n` +
        (a.expected ? `Erwartete Antwort (Referenz): ${a.expected}\n\n` : '') +
        (a.expectRefusal
          ? 'Hinweis: Die Auszüge decken diese Frage nach Erwartung NICHT ab.\n\n'
          : '') +
        `Auszüge:\n\n${excerpts}\n\nAntwort des Systems:\n${a.answer}`,
    }),
  );
  if (!res.output) throw new Error(`judge returned no structured output for ${a.id}`);
  // for a question the corpus cannot answer, "correct" means the system refused; no model opinion needed
  return a.expectRefusal ? { ...res.output, correct: !res.output.answered } : res.output;
}

export type Label = { id: string; faithful: boolean; reason?: string };

export async function loadJsonl<T>(file: string): Promise<T[]> {
  const text = await readFile(file, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => JSON.parse(l) as T);
}

export function agreement(verdicts: Map<string, Verdict>, labels: Label[]) {
  const pairs = labels.filter((l) => verdicts.has(l.id));
  if (pairs.length === 0) return null;
  const human = pairs.map((l) => l.faithful);
  const judge = pairs.map((l) => verdicts.get(l.id)!.faithful);
  const disagreements = pairs.filter((l, i) => human[i] !== judge[i]).map((l) => l.id);
  return {
    n: pairs.length,
    agree: 1 - disagreements.length / pairs.length,
    kappa: kappa(human, judge),
    disagreements,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  (async () => {
    const answers = await loadJsonl<Answered>(flag('answers') ?? 'eval/answers/latest.jsonl');
    if (answers.length === 0) throw new Error('no answers; run `pnpm answers` first');
    const verdicts = new Map<string, Verdict>();
    for (const a of answers) {
      const v = await judgeOne(a);
      verdicts.set(a.id, v);
      console.log(
        `${a.id.padEnd(12)} ${v.faithful ? 'faithful  ' : 'UNFAITHFUL'} ${v.answered ? '' : '(refused) '}${v.reason}`,
      );
    }
    await mkdir('eval/judgments', { recursive: true });
    await writeFile(
      'eval/judgments/latest.jsonl',
      [...verdicts].map(([id, v]) => JSON.stringify({ id, ...v })).join('\n') + '\n',
    );

    const all = [...verdicts.values()];
    const faithful = all.filter((v) => v.faithful).length / all.length;
    const answered = all.filter((v) => v.answered).length / all.length;
    const withRef = all.filter((v) => v.correct !== null);
    const correct = withRef.length
      ? withRef.filter((v) => v.correct).length / withRef.length
      : null;
    const labels = await loadJsonl<Label>(flag('labels') ?? 'eval/labels.jsonl');
    const agr = agreement(verdicts, labels);
    const cost = summarize(answers);

    console.log(
      `\n${all.length} judged · faithful ${(faithful * 100).toFixed(0)}% · answered ${(answered * 100).toFixed(0)}%` +
        (correct !== null
          ? ` · correct vs reference ${(correct * 100).toFixed(0)}% (n=${withRef.length})`
          : ''),
    );
    if (agr) {
      console.log(
        `judge vs ${agr.n} human labels: agreement ${(agr.agree * 100).toFixed(0)}%, Cohen's κ ${agr.kappa.toFixed(2)}`,
      );
      if (agr.disagreements.length) console.log(`disagreements: ${agr.disagreements.join(', ')}`);
    } else
      console.log(
        'no human labels yet (eval/labels.jsonl) — κ not computed; the judge is unverified',
      );

    if (args.includes('--readme')) {
      const md = await readFile('README.md', 'utf8');
      const [s, e] = ['<!-- judge:start -->', '<!-- judge:end -->'];
      const i = md.indexOf(s),
        j = md.indexOf(e);
      if (i < 0 || j < 0) throw new Error('README.md is missing the judge markers');
      const rows = [
        ['Measure', 'Value'],
        ['Faithful answers (judge)', `${(faithful * 100).toFixed(0)}% of ${all.length}`],
        ['Answered (not refused)', `${(answered * 100).toFixed(0)}%`],
        ...(correct !== null
          ? [['Correct vs reference answer', `${(correct * 100).toFixed(0)}% of ${withRef.length}`]]
          : []),
        [
          'Judge vs human labels',
          agr
            ? `agreement ${(agr.agree * 100).toFixed(0)}%, κ ${agr.kappa.toFixed(2)} (n=${agr.n})`
            : 'no labels yet',
        ],
        ['End-to-end latency', `avg ${cost.avgMs} ms, p95 ${cost.p95Ms} ms`],
        [
          'Tokens per query (in/out)',
          `${cost.tokensPerQuery.input} / ${cost.tokensPerQuery.output}`,
        ],
        [
          'Cost per query',
          cost.eurosPerQuery ? `€${cost.eurosPerQuery.toFixed(4)}` : 'set PRICE_*_PER_MTOK',
        ],
      ];
      const w = [0, 1].map((c) => Math.max(...rows.map((r) => r[c]!.length)));
      const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(w[i]!)).join(' | ')} |`;
      const table = [
        line(rows[0]!),
        `| ${w.map((n) => '-'.repeat(n)).join(' | ')} |`,
        ...rows.slice(1).map(line),
      ].join('\n');
      await writeFile(
        'README.md',
        md.slice(0, i + s.length) +
          '\n\n' +
          table +
          '\n\n' +
          `_Measured ${new Date().toISOString().slice(0, 10)} with \`pnpm answers && pnpm judge --readme\`._\n` +
          md.slice(j),
      );
      console.log('README.md answer-quality table updated');
    }

    if (args.includes('--gate')) {
      const t = (
        JSON.parse(await readFile('eval/thresholds.json', 'utf8')) as {
          judge?: { faithfulness: number; kappa: number };
        }
      ).judge;
      if (t) {
        const bad = faithful < t.faithfulness || (agr !== null && agr.kappa < t.kappa);
        if (bad) {
          console.error(
            `GATE FAILED judge: faithful ${faithful.toFixed(3)} < ${t.faithfulness} or κ ${agr?.kappa.toFixed(2)} < ${t.kappa}`,
          );
          process.exit(1);
        }
        console.log('judge gate passed');
      }
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
