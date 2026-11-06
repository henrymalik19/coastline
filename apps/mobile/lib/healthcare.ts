/**
 * Rough monthly cost of health coverage for one adult between retirement and Medicare (65):
 * an unsubsidized ACA marketplace silver plan plus typical out-of-pocket spending, in
 * today's dollars. Premiums rise with age (a 64-year-old pays about 3× a 21-year-old),
 * so the estimate averages the years from the retirement age up to 64.
 *
 * These are deliberately round, conservative ballparks for planning, not quotes.
 * Income-based subsidies can lower the real cost a lot.
 */
const BY_AGE: { upTo: number; monthly: number }[] = [
  { upTo: 39, monthly: 550 },
  { upTo: 49, monthly: 650 },
  { upTo: 54, monthly: 900 },
  { upTo: 59, monthly: 1100 },
  { upTo: 64, monthly: 1350 },
];

const costAt = (age: number) => (BY_AGE.find((b) => age <= b.upTo) ?? BY_AGE[BY_AGE.length - 1]!).monthly;

/** Average monthly estimate for one person from `retireAge` until 65 (0 if retiring at 65+). Rounded to $50. */
export function suggestHealthcare(retireAge: number): number {
  const start = Math.max(18, Math.round(retireAge));
  if (start >= 65) return 0;
  let total = 0;
  for (let a = start; a <= 64; a++) total += costAt(a);
  return Math.round(total / (65 - start) / 50) * 50;
}
