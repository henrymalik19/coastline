import { BUCKETS, type Bucket, type MonthRow } from "@coastfi/engine";

/** Round axis ticks from 0 to just above `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 1e-3; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** What a month puts where, by chart bucket. 401(k) includes payroll + match. */
export function bucketValues(m: MonthRow): Record<Bucket, number> {
  return {
    k401: m.payPre + m.payMatch + m.alloc.k401 + m.alloc.matchGain,
    ira: m.alloc.ira,
    taxable: m.alloc.taxable,
    ef: m.alloc.ef,
    debt: m.alloc.debt,
    hsa: m.alloc.hsa + (m.payHsa ?? 0) + m.payHsaEmployer,
    goals: m.alloc.goals,
  };
}

export const total = (v: Record<Bucket, number>) => BUCKETS.reduce((a, k) => a + v[k], 0);
