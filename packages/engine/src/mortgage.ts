/**
 * Mortgages and retirement: when the loan really ends (from what you owe now, so extra payments you
 * made already count), how that compares with the loan's original schedule, and what's still owed
 * when you retire. Your number counts what's owed then: that's what paying it off costs, and it's
 * what the remaining payments are worth in today's money (their interest is the loan's own rate).
 */
import type { Debt, Derived, PlanResult, PlanState } from "./types";
import { addMonths, monthsBetween, num } from "./util";

/** The longest a loan is followed (50 years); a payment that never pays it off stops here. */
const CAP = 600;

/** The loan part of the payment: the whole payment less escrow (property tax + insurance). */
export const loanPayment = (x: Pick<Debt, "minPayment" | "escrow">): number =>
  Math.max(0, num(x.minPayment) - Math.min(Math.max(0, num(x.escrow)), num(x.minPayment)));

/**
 * Paying `payment` a month on `balance` at `apr`: how many payments it takes (null if the payment
 * never pays it off) and the total paid.
 */
export function amortize(balance: number, apr: number, payment: number): { months: number | null; total: number } {
  let b = Math.max(0, num(balance));
  let total = 0;
  let m = 0;
  const r = Math.max(0, num(apr)) / 12;
  while (b > 0.005 && m < CAP) {
    b *= 1 + r;
    const p = Math.min(Math.max(0, payment), b);
    if (p <= 0) break;
    b -= p;
    total += p;
    m++;
  }
  return { months: b > 0.005 ? null : m, total };
}

/** The regular payment on a loan of `amount` at `apr` over `term` months. */
export function scheduledPayment(amount: number, apr: number, term: number): number {
  const r = Math.max(0, num(apr)) / 12;
  if (term <= 0) return 0;
  return r === 0 ? amount / term : (amount * r) / (1 - Math.pow(1 + r, -term));
}

export type LoanSchedule = {
  /** Which payment this month's is ("payment 49 of 360"). */
  paymentNumber: number;
  term: number;
  /** Last payment on the original schedule, "YYYY-MM". */
  scheduledEnd: string;
  /** Last payment at today's balance and payment, or null if the payment never pays it off. */
  actualEnd: string | null;
  /** Months ahead of the original schedule (negative = behind), or null when it can't tell. */
  aheadMonths: number | null;
  /** What the original schedule says you'd owe now (needs the original amount). */
  expectedBalance?: number;
};

/** A loan against its original schedule (needs its term and first payment month). `month` is "YYYY-MM", this month. */
export function loanSchedule(x: Debt, month: string): LoanSchedule | null {
  const term = Math.round(num(x.term));
  if (!(term > 0) || !x.firstPayment) return null;
  const made = Math.max(0, Math.min(term, monthsBetween(x.firstPayment, month)));
  const scheduledEnd = addMonths(x.firstPayment, term - 1);
  const left = num(x.balance) > 0.5 ? amortize(num(x.balance), num(x.apr), loanPayment(x)).months : 0;
  const actualEnd = left === null ? null : left === 0 ? addMonths(month, -1) : addMonths(month, left - 1);
  const out: LoanSchedule = {
    paymentNumber: Math.min(term, made + 1),
    term,
    scheduledEnd,
    actualEnd,
    aheadMonths: left === null ? null : term - made - left,
  };
  const amount = num(x.original);
  if (amount > 0) {
    const pay = scheduledPayment(amount, num(x.apr), term);
    let b = amount;
    for (let k = 0; k < made && b > 0; k++) b = Math.max(0, b * (1 + num(x.apr) / 12) - pay);
    out.expectedBalance = b;
  }
  return out;
}

export type DebtAtRetirement = {
  id: string;
  name: string;
  /** Still owed the month you retire (what your number counts). */
  balance: number;
  /** Payments left after you retire (null: the payment never pays it off; followed for 50 years). */
  months: number | null;
  /** Those payments added up, interest included, if you keep paying monthly instead of paying it off. */
  total: number;
};

/**
 * Mortgages still owed when you retire, as your plan runs them (extra payments included): what's owed
 * then, and what the payments left add up to if you keep paying monthly.
 */
export function mortgagesAtRetirement(s: Pick<PlanState, "debts">, d: Pick<Derived, "years">, plan: Pick<PlanResult, "months">): DebtAtRetirement[] {
  const M = d.years * 12;
  const row = M > 0 ? plan.months[M - 1] : undefined;
  const out: DebtAtRetirement[] = [];
  for (const x of s.debts ?? []) {
    if (x.kind !== "mortgage" || x.payroll || x.rental) continue; // a rental's rent pays it
    const balance = row ? (row.debts?.find((y) => y.id === x.id)?.balance ?? 0) : num(x.balance);
    if (!(balance > 0.5)) continue;
    const a = amortize(balance, num(x.apr), loanPayment(x));
    out.push({ id: x.id, name: x.name, balance, months: a.months, total: a.total });
  }
  return out;
}
