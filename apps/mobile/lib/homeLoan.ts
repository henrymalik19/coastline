/** A mortgage in words: its place on the original schedule, when your plan pays it off, and retirement. */
import { loanSchedule, type Debt, type RunResult } from "@coastfi/engine";
import { money, monthLabel } from "./format";
import { monthKey } from "./store";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ym = (s: string) => `${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;

/** "8 months", "3 years", "2.5 years". */
export function spanText(months: number): string {
  const m = Math.abs(Math.round(months));
  if (m < 12) return `${m} month${m === 1 ? "" : "s"}`;
  const y = Math.round((m / 12) * 2) / 2;
  return `${String(y).replace(/\.0$/, "")} year${y === 1 ? "" : "s"}`;
}

export type MortgageStatus = {
  /** "Payment 49 of 360" and how you're doing against the original schedule. */
  schedule: string[];
  /** When your plan pays it off. */
  payoff: string | null;
  /** Owed when you retire and what it adds to your number, or that it's paid off first. */
  retire: string | null;
  /** True when payments run into retirement. */
  intoRetirement: boolean;
};

export function mortgageStatus(debt: Debt, result: RunResult, start: Date): MortgageStatus {
  const out: MortgageStatus = { schedule: [], payoff: null, retire: null, intoRetirement: false };
  const sched = loanSchedule(debt, monthKey(start));
  if (sched) {
    out.schedule.push(`Payment ${sched.paymentNumber} of ${sched.term}. The original schedule ends ${ym(sched.scheduledEnd)}.`);
    if (sched.aheadMonths === null) out.schedule.push("Your payment doesn't cover the interest, so the balance never gets paid off.");
    else if (Math.abs(sched.aheadMonths) <= 1) out.schedule.push(`On schedule: paid off ${ym(sched.actualEnd!)}.`);
    else if (sched.aheadMonths > 0) out.schedule.push(`About ${spanText(sched.aheadMonths)} ahead of schedule from extra payments: paid off ${ym(sched.actualEnd!)} instead of ${ym(sched.scheduledEnd)}.`);
    else out.schedule.push(`About ${spanText(sched.aheadMonths)} behind the original schedule (a refinance or missed payments?): paid off ${ym(sched.actualEnd!)}.`);
    if (sched.expectedBalance !== undefined && Math.abs(sched.expectedBalance - debt.balance) > 1)
      out.schedule.push(`The schedule has you owing ${money(sched.expectedBalance, { whole: true })} now; you owe ${money(debt.balance, { whole: true })}.`);
  }
  const ev = result.plan.events.find((e) => e.key === "debt:" + debt.id);
  if (ev) out.payoff = `Your plan pays it off ${monthLabel(start, ev.m)}, at age ${Math.floor(result.d.age + ev.m / 12)}.`;
  const left = result.mortgagesAtRetire.find((x) => x.id === debt.id);
  if (left) {
    out.intoRetirement = true;
    out.retire = `${money(left.balance, { whole: true })} is still owed when you retire at ${result.d.retireAge}${left.months !== null ? `, ${spanText(left.months)} of payments` : ""}. Your savings has to cover them, which adds about ${money(left.total, { whole: true })} to your number.`;
  } else if (debt.balance > 0.5) out.retire = "Paid off before you retire: only property tax and insurance (escrow) carry into retirement.";
  return out;
}
