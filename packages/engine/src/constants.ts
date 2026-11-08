import type { BaseStepKey, PayFreq } from "./types";

/** Paychecks per year. */
export const PERIODS: Record<PayFreq, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
/** Paychecks in a "normal" month (extra checks above this are bonus months). */
export const BASE_CHECKS: Record<PayFreq, number> = { weekly: 4, biweekly: 2, semimonthly: 2, monthly: 1 };

export const STEP_LABELS: Record<BaseStepKey, string> = {
  starterEF: "Starter emergency fund",
  match: "Get the full employer match",
  highDebt: "Pay off high-interest debt",
  fullEF: "Full emergency fund",
  hsa: "Max out HSA",
  ira: "Max out IRA",
  iraSpouse: "Max out your spouse's IRA",
  k401: "Max out 401(k)",
  lowDebt: "Pay down low-interest debt",
  taxable: "Invest in brokerage",
};

/** Chart buckets, in the validated categorical slot order (stacking order). */
export const BUCKETS = ["k401", "ira", "taxable", "ef", "debt", "hsa", "goals"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABELS: Record<Bucket, string> = {
  k401: "401(k)",
  ira: "IRA",
  taxable: "Brokerage",
  ef: "Emergency fund",
  debt: "Extra debt payments",
  hsa: "HSA",
  goals: "Goals",
};
