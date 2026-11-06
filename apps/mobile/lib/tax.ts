/**
 * Rough paycheck tax estimate, used only to pre-fill take-home pay (the user can override it).
 * Single filer, 2025 federal brackets and standard deduction, Social Security + Medicare,
 * and a flat state rate. Real withholding varies (filing status, credits, state, local),
 * so the UI labels this an estimate and suggests checking a pay stub.
 */

const STANDARD_DEDUCTION = 15_750;
const BRACKETS: [upTo: number, rate: number][] = [
  [11_925, 0.1],
  [48_475, 0.12],
  [103_350, 0.22],
  [197_300, 0.24],
  [250_525, 0.32],
  [626_350, 0.35],
  [Infinity, 0.37],
];
const SS_RATE = 0.062;
const SS_WAGE_BASE = 176_100;
const MEDICARE_RATE = 0.0145;
const ADDL_MEDICARE_RATE = 0.009;
const ADDL_MEDICARE_OVER = 200_000;
/** Flat state income tax used for the estimate (roughly a middle-of-the-road state). */
export const STATE_RATE = 0.04;

export function federalIncomeTax(taxable: number): number {
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of BRACKETS) {
    if (taxable <= lower) break;
    tax += (Math.min(taxable, upTo) - lower) * rate;
    lower = upTo;
  }
  return tax;
}

export type TaxBreakdown = { federal: number; state: number; socialSecurity: number; medicare: number };

/**
 * Estimated yearly taxes for `annualGross` with `annualPretax` taken out before tax (401(k),
 * health premiums), which lowers income tax but not Social Security / Medicare.
 */
export function estimateAnnualTaxes(annualGross: number, annualPretax = 0): TaxBreakdown {
  if (!(annualGross > 0)) return { federal: 0, state: 0, socialSecurity: 0, medicare: 0 };
  const incomeBase = Math.max(0, annualGross - Math.max(0, annualPretax));
  return {
    federal: federalIncomeTax(Math.max(0, incomeBase - STANDARD_DEDUCTION)),
    state: incomeBase * STATE_RATE,
    socialSecurity: Math.min(annualGross, SS_WAGE_BASE) * SS_RATE,
    medicare: annualGross * MEDICARE_RATE + Math.max(0, annualGross - ADDL_MEDICARE_OVER) * ADDL_MEDICARE_RATE,
  };
}

/** Same estimate, per paycheck (rounded to cents) — used to pre-fill pay-stub fields. */
export function estimatePaycheckTaxes(grossPerCheck: number, checksPerYear: number, pretaxPerCheck = 0): TaxBreakdown {
  const y = estimateAnnualTaxes(grossPerCheck * checksPerYear, pretaxPerCheck * checksPerYear);
  const per = (v: number) => Math.round((v / checksPerYear) * 100) / 100;
  return { federal: per(y.federal), state: per(y.state), socialSecurity: per(y.socialSecurity), medicare: per(y.medicare) };
}

/** Total estimated taxes as a share of gross. */
export function estimateTaxRate(annualGross: number, annualPretax = 0): number {
  if (!(annualGross > 0)) return 0;
  const t = estimateAnnualTaxes(annualGross, annualPretax);
  return (t.federal + t.state + t.socialSecurity + t.medicare) / annualGross;
}
