/**
 * Your history, without a check-in form. Each month keeps one record of your balances as they were at
 * the end of it: the app saves this month's on its own whenever your balances change, so the record
 * is always the latest (the month-end value once the month is over). Past months stay as they ended.
 * The comparison with the plan is worked out from those records, so it follows any change.
 */
import { budgetCategories, budgetView, derive, project, type PlanResult, type PlanState, type RunResult, type Txn } from "@coastfi/engine";
import type { Checkin } from "@coastfi/schema";
import { useEffect } from "react";
import { netWorth } from "./networth";
import { cardMap, liveBudget, todayIso } from "./register";
import { monthKey, useStore } from "./store";
import { usePlan } from "./plan";
import { prevMonthKey, streakFrom, type Streak } from "./historyCore";

export { investedHistory, prevMonthKey, streakFrom, vsPlan, type HistoryPoint, type Streak } from "./historyCore";

const cents = (v: number) => Math.round(v * 100) / 100;

/** This month's record, from your balances now. The plan line comes from the real plan (no what-ifs). */
export function snapshotNow(state: PlanState, o: RunResult, actual: PlanResult, start: Date): Checkin {
  const d = o.d;
  const real: PlanState = { ...state, whatif: { extra: 0, retDelta: 0, spendDelta: 0 }, adjustments: [] };
  const dr = derive(real, start);
  const series = project(dr, actual, dr.r).series;
  return {
    month: monthKey(start),
    date: `${monthKey(start)}-${String(start.getDate()).padStart(2, "0")}`,
    invested: cents(d.invested),
    cash: cents(d.bal.cash),
    debt: cents(d.debtTotal),
    netWorth: cents(netWorth(d, state)),
    expectedNextInvested: cents(series.length > 1 ? series[1]! : d.invested),
  };
}

const same = (a: Checkin | undefined, b: Checkin) =>
  !!a && a.invested === b.invested && a.cash === b.cash && a.debt === b.debt && a.netWorth === b.netWorth && a.expectedNextInvested === b.expectedNextInvested;

/** Keep this month's record up to date (mounted once, under the tabs). Waits a moment so typing doesn't save every keystroke. */
export function useMonthRecord() {
  const { state, result, actual, start } = usePlan();
  const onboarded = useStore((s) => s.onboarded);
  const hydrated = useStore((s) => s.hydrated);
  const checkins = useStore((s) => s.checkins);
  const record = useStore((s) => s.recordMonth);
  useEffect(() => {
    if (!hydrated || !onboarded) return;
    const id = setTimeout(() => {
      const snap = snapshotNow(state, result, actual, start);
      const cur = checkins.find((c) => c.month === snap.month);
      if (!same(cur, snap)) record(snap);
    }, 2000);
    return () => clearTimeout(id);
  }, [hydrated, onboarded, state, result, actual, start, checkins, record]);
}

/**
 * The streak: months you stayed within your budget (no category overspent), from your
 * transactions. Before you budget in the app: months your balances were kept up to date.
 */
export function useStreak(): Streak {
  const { state, result, actual, start } = usePlan();
  const txns = useStore((s) => s.txns);
  const checkins = useStore((s) => s.checkins);
  return streakFor(state, result, actual, start, txns, checkins);
}

let memo: { args: unknown[]; value: Streak } | null = null;
export function streakFor(state: PlanState, o: RunResult, actual: PlanResult, start: Date, txns: Txn[], checkins: Checkin[]): Streak {
  const args = [state, o, actual, start, txns, checkins];
  if (memo && memo.args.every((a, i) => a === args[i])) return memo.value;
  let value: Streak;
  const b = liveBudget(state, txns);
  if (b && txns.some((t) => !t.deleted && !t.payee?.startsWith("Starting balance"))) {
    const cur = monthKey(start);
    const keys = new Set<string>();
    const tx = { txns, cards: cardMap(state), asOf: todayIso(start) };
    for (let m = cur, i = 0; m >= b.start && i < 24; m = prevMonthKey(m), i++) {
      const v = budgetView(b, budgetCategories(state, o.d, actual, start, m), m, tx);
      // within budget: no category ended up overspent (money saved up from earlier months counts)
      if (v.started && Object.values(v.lines).every((l) => l.available > -0.5)) keys.add(m);
    }
    value = streakFrom(keys, start, "budget");
  } else {
    value = streakFrom(new Set(checkins.map((c) => c.month)), start, "tracked");
  }
  memo = { args, value };
  return value;
}
