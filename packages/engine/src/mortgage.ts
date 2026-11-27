/**
 * Mortgages and retirement: when the loan really ends (from what you owe now, so extra payments you
 * made already count), how that compares with the loan's original schedule, and what one still running
 * when you retire costs your number: paying it off then (what's owed), or keeping up the payments from
 * money set aside, which keeps growing while it's paid out (and the payment, fixed, buys less each year).
 */
import type { Debt, Derived, PlanResult, PlanState } from "./types";
import { DISPLAY_INFLATION } from "./inflation";
import { addMonths, monthsBetween, num } from "./util";
import { isKeptRentalDebt, isRentalDebt } from "./schedule";

/** The longest a loan is followed (50 years); a payment that never pays it off stops here. */
const CAP = 600;

/** The loan part of the payment: the whole payment less escrow (property tax + insurance). */
export const loanPayment = (x: Pick<Debt, "minPayment" | "escrow">): number =>
  Math.max(0, num(x.minPayment) - Math.min(Math.max(0, num(x.escrow)), num(x.minPayment)));

/**
 * Paying `payment` a month on `balance` at `apr`: how many payments it takes (null if the payment
 * never pays it off) and the total paid.
 */
export function amortize(balance: number, apr: number, payment: number, discount = 0): { months: number | null; total: number; worth: number } {
  let b = Math.max(0, num(balance));
  let total = 0;
  // `worth`: the payments as money set aside today, earning `discount` a month until each is paid
  let worth = 0;
  let f = 1;
  let m = 0;
  const r = Math.max(0, num(apr)) / 12;
  while (b > 0.005 && m < CAP) {
    b *= 1 + r;
    const p = Math.min(Math.max(0, payment), b);
    if (p <= 0) break;
    b -= p;
    total += p;
    f /= 1 + Math.max(0, discount);
    worth += p * f;
    m++;
  }
  return { months: b > 0.005 ? null : m, total, worth };
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
  /** Still owed the month you retire. */
  balance: number;
  /** Payments left after you retire (null: the payment never pays it off; followed for 50 years). */
  months: number | null;
  /** Those payments added up, interest included. */
  total: number;
  /**
   * Keeping up the payments: what to set aside when you retire, which keeps growing at your plan's return
   * while it's paid out (null when the payment never pays it off).
   */
  keepCost: number | null;
  /** Paying it off when you retire: what's owed then. */
  payoffCost: number;
  /** What your plan does: your choice (Debt.atRetire), else the cheaper one. */
  choice: "keep" | "payoff";
  /** Your choice, when you made one. */
  chosen?: "keep" | "payoff";
};

/** What a mortgage still running when you retire adds to your number: keeping it up, or paying it off (its `choice`). */
export const mortgageBridge = (x: Pick<DebtAtRetirement, "choice" | "keepCost" | "payoffCost">) => (x.choice === "keep" && x.keepCost !== null ? x.keepCost : x.payoffCost);

/**
 * Mortgages still owed when you retire, as your plan runs them (extra payments included): what's owed
 * then, and what the payments left add up to if you keep paying monthly.
 */
export function mortgagesAtRetirement(s: Pick<PlanState, "debts" | "properties">, d: Pick<Derived, "years" | "r">, plan: Pick<PlanResult, "months">): DebtAtRetirement[] {
  const M = d.years * 12;
  // what money set aside earns a month, before inflation (the payment is a fixed dollar amount)
  const grow = Math.pow((1 + num(d.r)) * (1 + DISPLAY_INFLATION), 1 / 12) - 1;
  const row = M > 0 ? plan.months[M - 1] : undefined;
  const out: DebtAtRetirement[] = [];
  for (const x of s.debts ?? []) {
    // a rental you sell before you retire: its rent pays it until then. One you keep: what's owed counts, like a home's
    if (x.kind !== "mortgage" || x.payroll || (isRentalDebt(s, x) && !isKeptRentalDebt(s, x))) continue;
    const balance = row ? (row.debts?.find((y) => y.id === x.id)?.balance ?? 0) : num(x.balance);
    if (!(balance > 0.5)) continue;
    const a = amortize(balance, num(x.apr), loanPayment(x), grow);
    const keepCost = a.months === null ? null : a.worth;
    const chosen = x.atRetire;
    const choice = keepCost === null ? "payoff" : chosen ?? (keepCost < balance ? "keep" : "payoff");
    out.push({ id: x.id, name: x.name, balance, months: a.months, total: a.total, keepCost, payoffCost: balance, choice, ...(chosen ? { chosen } : {}) });
  }
  return out;
}
