export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!;
}

/** Cohen's kappa for two binary raters over the same items; 1 = perfect, 0 = chance, <0 = worse than chance. */
export function kappa(a: boolean[], b: boolean[]): number {
  if (a.length !== b.length || a.length === 0)
    throw new Error('kappa needs two equal, non-empty label lists');
  const n = a.length;
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pa = a.filter(Boolean).length / n;
  const pb = b.filter(Boolean).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/** Euro cost from token counts and per-million-token prices (0 when a price is unset). */
export function euros(
  tokens: { input: number; output: number },
  price: { input: number; output: number },
): number {
  return (tokens.input * price.input + tokens.output * price.output) / 1e6;
}
