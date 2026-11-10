import { PERIODS, type FilingStatus, type Income, type PayTaxes } from "@coastfi/engine";
import { paycheck } from "./paycheck";

/**
 * Rough paycheck tax estimate, used only to pre-fill pay-stub fields (the user can edit them).
 * 2025 federal brackets and standard deductions by filing status, Social Security + Medicare,
 * and a flat state rate. Real withholding varies (credits, W-4 choices, state, local), so the
 * UI labels this an estimate and suggests copying a pay stub.
 *
 * All jobs in a plan are treated as one tax return (a married couple filing jointly, or one
 * person with several jobs): federal tax is figured on the combined income, then split between
 * jobs by their share of it. Social Security and Medicare are per job, as they're withheld.
 */

type Table = { standard: number; brackets: [upTo: number, rate: number][] };

export const TAX_TABLES: Record<FilingStatus, Table> = {
  single: {
    standard: 15_750,
    brackets: [[11_925, 0.1], [48_475, 0.12], [103_350, 0.22], [197_300, 0.24], [250_525, 0.32], [626_350, 0.35], [Infinity, 0.37]],
  },
  mfj: {
    standard: 31_500,
    brackets: [[23_850, 0.1], [96_950, 0.12], [206_700, 0.22], [394_600, 0.24], [501_050, 0.32], [751_600, 0.35], [Infinity, 0.37]],
  },
  hoh: {
    standard: 23_625,
    brackets: [[17_000, 0.1], [64_850, 0.12], [103_350, 0.22], [197_300, 0.24], [250_500, 0.32], [626_350, 0.35], [Infinity, 0.37]],
  },
};

export const FILING_LABELS: Record<FilingStatus, string> = {
  single: "Single",
  mfj: "Married filing jointly",
  hoh: "Head of household",
};

const SS_RATE = 0.062;
const SS_WAGE_BASE = 176_100;
const MEDICARE_RATE = 0.0145;
const ADDL_MEDICARE_RATE = 0.009;
/** Employers withhold the extra 0.9% Medicare on each employee's wages over $200k. */
const ADDL_MEDICARE_OVER = 200_000;
/** Flat state income tax used for the estimate (roughly a middle-of-the-road state). */
export const STATE_RATE = 0.04;

export function federalIncomeTax(taxable: number, status: FilingStatus = "single"): number {
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of TAX_TABLES[status].brackets) {
    if (taxable <= lower) break;
    tax += (Math.min(taxable, upTo) - lower) * rate;
    lower = upTo;
  }
  return tax;
}

export type TaxBreakdown = { federal: number; state: number; socialSecurity: number; medicare: number };

/** A job's yearly pay, and what comes out before income tax (401(k), health premiums). */
export type JobPayYear = { gross: number; pretax: number };

/**
 * Estimated yearly taxes for one job, filed together with `otherJobs` on the same return.
 * Federal income tax is figured on everyone's combined income and split by each job's share.
 */
export function estimateAnnualTaxes(job: JobPayYear, status: FilingStatus = "single", otherJobs: JobPayYear[] = []): TaxBreakdown {
  if (!(job.gross > 0)) return { federal: 0, state: 0, socialSecurity: 0, medicare: 0 };
  const base = (j: JobPayYear) => Math.max(0, j.gross - Math.max(0, j.pretax));
  const mine = base(job);
  const household = mine + otherJobs.reduce((a, j) => a + base(j), 0);
  const householdFederal = federalIncomeTax(Math.max(0, household - TAX_TABLES[status].standard), status);
  return {
    federal: household > 0 ? householdFederal * (mine / household) : 0,
    state: mine * STATE_RATE,
    socialSecurity: Math.min(job.gross, SS_WAGE_BASE) * SS_RATE,
    medicare: job.gross * MEDICARE_RATE + Math.max(0, job.gross - ADDL_MEDICARE_OVER) * ADDL_MEDICARE_RATE,
  };
}

/** Same estimate per paycheck (rounded to cents), to pre-fill pay-stub fields. */
export function estimatePaycheckTaxes(
  grossPerCheck: number,
  checksPerYear: number,
  pretaxPerCheck = 0,
  status: FilingStatus = "single",
  otherJobs: JobPayYear[] = [],
): TaxBreakdown {
  const y = estimateAnnualTaxes({ gross: grossPerCheck * checksPerYear, pretax: pretaxPerCheck * checksPerYear }, status, otherJobs);
  const per = (v: number) => Math.round((v / checksPerYear) * 100) / 100;
  return { federal: per(y.federal), state: per(y.state), socialSecurity: per(y.socialSecurity), medicare: per(y.medicare) };
}

/** Total estimated taxes as a share of gross, for one job filed alone. */
export function estimateTaxRate(annualGross: number, annualPretax = 0, status: FilingStatus = "single"): number {
  if (!(annualGross > 0)) return 0;
  const t = estimateAnnualTaxes({ gross: annualGross, pretax: annualPretax }, status);
  return (t.federal + t.state + t.socialSecurity + t.medicare) / annualGross;
}

/** The federal bracket (top rate) that `taxable` income falls in. */
export function federalBracket(taxable: number, status: FilingStatus = "single"): number {
  if (!(taxable > 0)) return TAX_TABLES[status].brackets[0]![1];
  for (const [upTo, rate] of TAX_TABLES[status].brackets) if (taxable <= upTo) return rate;
  return TAX_TABLES[status].brackets.at(-1)![1];
}

export type BracketEstimate = { federal: number; state: number; total: number; taxable: number };

/**
 * Estimated top tax rate (federal bracket + flat state rate) for the whole household, from
 * every income in the plan. Jobs with gross pay count gross − 401(k) − pre-tax deductions;
 * other incomes (or jobs entered by take-home only) count their take-home, a rough lower bound.
 * Returns null when there's no income to go on.
 */
export function estimateBracket(incomes: Income[], status: FilingStatus = "single"): BracketEstimate | null {
  let base = 0;
  for (const inc of incomes) {
    const P = PERIODS[inc.freq];
    const p = paycheck(inc);
    base += (inc.kind ?? "job") === "job" && p.gross > 0 ? Math.max(0, p.gross - p.k401Pretax - p.pretaxDeductions) * P : Math.max(0, inc.net) * P;
  }
  if (!(base > 0)) return null;
  const taxable = Math.max(0, base - TAX_TABLES[status].standard);
  const federal = federalBracket(taxable, status);
  return { federal, state: STATE_RATE, total: federal + STATE_RATE, taxable };
}

/**
 * Estimated taxes for one paycheck of a job in a plan (the plan's other jobs share the tax return,
 * and the filing status comes from the plan).
 */
export function estimateJobTaxes(s: { incomes: Income[]; filingStatus?: FilingStatus }, inc: Income): PayTaxes {
  const otherJobs = s.incomes
    .filter((j) => j.id !== inc.id && (j.kind ?? "job") === "job" && (j.gross ?? 0) > 0)
    .map((j) => {
      const p = paycheck(j);
      return { gross: p.gross * PERIODS[j.freq], pretax: (p.k401Pretax + p.pretaxDeductions) * PERIODS[j.freq] };
    });
  const p = paycheck(inc);
  return estimatePaycheckTaxes(inc.gross ?? 0, PERIODS[inc.freq], p.k401Pretax + p.pretaxDeductions, s.filingStatus ?? "single", otherJobs);
}

const TAX_KEYS = ["federal", "state", "socialSecurity", "medicare"] as const;
export const taxTotal = (x: PayTaxes) => TAX_KEYS.reduce((a, k) => a + (x[k] ?? 0), 0);
export const sameTaxes = (a: PayTaxes, b: PayTaxes) => TAX_KEYS.every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.01);

/**
 * True while a job's taxes are still the estimate (or empty): then they follow pay changes, so
 * nobody has to press "estimate" again after changing their pay or 401(k).
 */
export function taxesFollowEstimate(inc: Income, estimate: (i: Income) => PayTaxes): boolean {
  const taxes = inc.taxes ?? { federal: 0, state: 0, socialSecurity: 0, medicare: 0 };
  return taxTotal(taxes) === 0 || ((inc.gross ?? 0) > 0 && sameTaxes(taxes, estimate(inc)));
}
