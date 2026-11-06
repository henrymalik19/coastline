import type { FilingStatus } from "@coastfi/engine";

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
