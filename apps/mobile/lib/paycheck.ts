import { resolveIncome, type Income, type PayDeductionKind } from "@coastfi/engine";

export const DEDUCTION_KINDS: { value: PayDeductionKind; label: string; pretax: boolean }[] = [
  { value: "health", label: "Health insurance", pretax: true },
  { value: "dentalVision", label: "Dental & vision", pretax: true },
  { value: "lifeDisability", label: "Life & disability", pretax: false },
  { value: "union", label: "Union dues", pretax: false },
  { value: "k401_loan", label: "401(k) loan repayment", pretax: false },
  { value: "other", label: "Other", pretax: false },
];

/** A paycheck broken down the way a pay stub shows it (per check). */
export function paycheck(inc: Income) {
  const gross = Math.max(0, inc.gross ?? 0);
  const k401 = resolveIncome(inc).pretax;
  const t = inc.taxes ?? { federal: 0, state: 0, socialSecurity: 0, medicare: 0 };
  const taxes = t.federal + t.state + t.socialSecurity + t.medicare;
  // a 401(k) loan repayment is paid as a debt (its own monthly payment), so take-home leaves it in
  const loanRepayment = (inc.deductions ?? []).filter((x) => x.kind === "k401_loan").reduce((a, x) => a + Math.max(0, x.amount), 0);
  const deductions = (inc.deductions ?? []).filter((x) => x.kind !== "k401_loan").reduce((a, x) => a + Math.max(0, x.amount), 0);
  /** Deductions that usually come out before tax (they lower the tax estimate). */
  const pretaxDeductions = (inc.deductions ?? [])
    .filter((x) => DEDUCTION_KINDS.find((k) => k.value === x.kind)?.pretax)
    .reduce((a, x) => a + Math.max(0, x.amount), 0);
  const net = Math.max(0, Math.round((gross - k401 - taxes - deductions) * 100) / 100);
  return { gross, k401, taxes, deductions, pretaxDeductions, loanRepayment, net };
}

/** Apply a change to a job; in auto mode, take-home is recalculated from the pay stub fields. */
export function withAutoNet(inc: Income, patch: Partial<Income>): Partial<Income> {
  const next = { ...inc, ...patch };
  if ((next.kind ?? "job") === "job" && next.netMode === "auto") return { ...patch, net: paycheck(next).net };
  return patch;
}
