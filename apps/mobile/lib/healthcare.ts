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

/**
 * Rough monthly cost per child under 21 (premium + typical out-of-pocket). Marketplace plans
 * charge for at most the 3 oldest children under 21, so extra kids add nothing.
 */
export const CHILD_MONTHLY = 400;
export const MAX_CHARGED_CHILDREN = 3;

/** Household estimate: adults at the age-based rate plus children (capped at 3 charged). Rounded to $50. */
export function suggestHousehold(retireAge: number, adults: 1 | 2, children: number): number {
  const one = suggestHealthcare(retireAge);
  if (one === 0) return 0;
  const kids = Math.min(Math.max(0, Math.round(children)), MAX_CHARGED_CHILDREN) * CHILD_MONTHLY;
  return Math.round((one * adults + kids) / 50) * 50;
}

/** Average monthly estimate for one person from `retireAge` until 65 (0 if retiring at 65+). Rounded to $50. */
export function suggestHealthcare(retireAge: number): number {
  const start = Math.max(18, Math.round(retireAge));
  if (start >= 65) return 0;
  let total = 0;
  for (let a = start; a <= 64; a++) total += costAt(a);
  return Math.round(total / (65 - start) / 50) * 50;
}
