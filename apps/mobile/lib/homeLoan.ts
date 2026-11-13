/** A mortgage in words: where you are on it, when it's paid off, and what's left when you retire. */
import { amortize, loanPayment, loanSchedule, type Debt, type RunResult } from "@coastfi/engine";
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

export type StatusRow = { label: string; value: string; note?: string; tone?: "good" | "warn" };

export type MortgageStatus = {
  rows: StatusRow[];
  /** One short line for the collapsed mortgage, or null. */
  summary: string | null;
  /** Still owed when you retire. */
  intoRetirement: boolean;
};

export function mortgageStatus(debt: Debt, result: RunResult, start: Date, rental = false): MortgageStatus {
  const rows: StatusRow[] = [];
  const now = monthKey(start);
  const sched = loanSchedule(debt, now);
  const owes = debt.balance > 0.5;
  let summary: string | null = null;

  if (sched) rows.push({ label: "Payment", value: `${sched.paymentNumber} of ${sched.term}` });

  // when it's paid off at the regular payment (from what you owe now, so extra payments you made count)
  if (owes) {
    const left = amortize(debt.balance, debt.apr, loanPayment(debt)).months;
    if (left === null) rows.push({ label: "Paid off", value: "Never", note: "The payment doesn't cover the interest", tone: "warn" });
    else {
      const end = monthLabel(start, left - 1);
      let note: string | undefined;
      let tone: StatusRow["tone"];
      if (sched?.aheadMonths != null) {
        if (Math.abs(sched.aheadMonths) <= 1) note = "On schedule";
        else if (sched.aheadMonths > 0) {
          note = `${spanText(sched.aheadMonths)} ahead of the original ${ym(sched.scheduledEnd)}`;
          tone = "good";
          summary = `${spanText(sched.aheadMonths)} ahead of schedule`;
        } else {
          note = `${spanText(sched.aheadMonths)} behind the original ${ym(sched.scheduledEnd)}`;
          tone = "warn";
        }
      }
      rows.push({ label: "Paid off", value: end, note, tone });
      // the plan may pay it off sooner with extra payments
      const ev = result.plan.events.find((e) => e.key === "debt:" + debt.id);
      if (ev && ev.m < left - 1) rows.push({ label: "With your plan", value: monthLabel(start, ev.m), note: "Paying extra, as your priority order does", tone: "good" });
    }
  }

  if (sched?.expectedBalance !== undefined && Math.abs(sched.expectedBalance - debt.balance) > 1)
    rows.push({ label: "Schedule says you'd owe", value: money(sched.expectedBalance, { whole: true }), note: `You owe ${money(debt.balance, { whole: true })}` });

  const atRetire = result.mortgagesAtRetire.find((x) => x.id === debt.id);
  if (atRetire) {
    rows.push({
      label: `When you retire at ${result.d.retireAge}`,
      value: `${money(atRetire.balance, { whole: true })} owed`,
      note: `Counted in your number, so you could pay it off then.${atRetire.months !== null ? ` Keep paying monthly instead: ${atRetire.months} more payment${atRetire.months === 1 ? "" : "s"}, about ${money(atRetire.total, { whole: true })} with interest.` : ""}`,
      tone: "warn",
    });
    summary = `${money(atRetire.balance, { whole: true })} still owed when you retire`;
  } else if (rental) rows.push({ label: `When you retire at ${result.d.retireAge}`, value: "Not counted", note: "A rental: its rent pays the mortgage, tax and insurance" });
  else if (owes) rows.push({ label: `When you retire at ${result.d.retireAge}`, value: "Paid off", note: "Only escrow (property tax + insurance) carries on", tone: "good" });

  if (rental) summary = summary ? `Rental · ${summary}` : "Rental";
  return { rows, summary, intoRetirement: !!atRetire };
}
