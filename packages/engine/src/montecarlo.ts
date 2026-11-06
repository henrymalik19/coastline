import type { Derived, MonteCarloOptions, MonteCarloResult, PlanResult } from "./types";
import { gaussian, mulberry32, pct } from "./util";

/**
 * Annual lognormal paths: G = exp(ln(1+r) + vol x Z), so the median growth is r.
 * Each year's contributions are added as c x sqrt(G) (mid-year approximation).
 * Seeded, so the same inputs always give the same bands.
 */
export function monteCarlo(
  d: Derived,
  plan: PlanResult,
  r: number,
  fire: number,
  opts: MonteCarloOptions = {},
): MonteCarloResult {
  const sims = opts.sims || 2000;
  const rand = mulberry32(opts.seed || 1234);
  const m = Math.log(1 + r);
  const s = d.vol;
  const Y = d.years;
  const contrib = Array.from({ length: Y }, (_, y) => {
    let c = 0;
    for (let k = y * 12; k < y * 12 + 12; k++) c += plan.months[k]!.pre + plan.months[k]!.post;
    return c;
  });
  const byYear = Array.from({ length: Y + 1 }, () => new Float64Array(sims));
  let hit = 0;
  let coastHit = 0;
  for (let i = 0; i < sims; i++) {
    let b = d.invested;
    let cb = d.invested;
    byYear[0]![i] = b;
    for (let y = 0; y < Y; y++) {
      const G = Math.exp(m + s * gaussian(rand));
      b = b * G + contrib[y]! * Math.sqrt(G);
      cb = cb * G;
      byYear[y + 1]![i] = b;
    }
    if (b >= fire) hit++;
    if (cb >= fire) coastHit++;
  }
  const bands = byYear.map((arr) => {
    const a = Array.from(arr).sort((x, y) => x - y);
    return { p10: pct(a, 0.1), p25: pct(a, 0.25), p50: pct(a, 0.5), p75: pct(a, 0.75), p90: pct(a, 0.9) };
  });
  return { bands, probFire: hit / sims, probCoastNow: coastHit / sims };
}
