/** Coerce anything to a number the way the prototype does (`+v || 0`). */
export const num = (v: unknown): number => +(v as number) || 0;
export const sum = (xs: readonly unknown[]): number => xs.reduce<number>((a, b) => a + num(b), 0);

/** Seeded PRNG (mulberry32): uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller (cosine branch only, matching the prototype). */
export function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Linear-interpolated percentile of an ascending-sorted array. */
export function pct(sorted: ArrayLike<number>, p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** "YYYY-MM-DD" to UTC epoch ms, or null. */
export function parseDate(s: string | undefined | null): number | null {
  if (!s) return null;
  const [y, m, d] = String(s).split("-").map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) : null;
}
