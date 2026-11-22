/**
 * Accounts filling up: each account against its target (the emergency fund, this year's limit for the
 * 401(k) / HSA / IRA, a goal) or its payoff (a debt), and when it gets there. Tap one for its month by
 * month forecast.
 */
import { accountForecasts, accountGroup, BUCKET_LABELS, isSpouseIra, type AccountKey } from "@coastfi/engine";
import { spouseIraLabel } from "../lib/spouse";
import { useStore } from "../lib/store";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { debtLabel } from "../lib/debts";
import { money, monthLabel } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useOpenPage } from "../lib/nav";
import { stepInfo } from "../lib/steps";
import { space, type, useTheme } from "../lib/theme";
import { InfoText, InfoTip, Select } from "./form";
import { Icon } from "./Icon";
import { Card, Divider, SectionLabel } from "./ui";

type Row = {
  key: AccountKey;
  name: string;
  /** Right side: "$13,962 of $23,820", "$3,000 owed". */
  value: string;
  /** 0–1, or none (brokerage, debts). */
  progress?: number;
  /** 0–1: where the plan has it by December (drawn lighter behind `progress`). */
  later?: number;
  /** When / how it gets there: one short line. */
  status: string;
  /** The detail, in the row's ⓘ. */
  info?: string;
  /** Something to fill in for an exact answer: a short nudge (the why is in the ⓘ). */
  needs?: string;
  color: string;
  done?: boolean;
};

const INFO = "Where each account stands now (solid) and where your plan gets it by the date you pick (lighter), at the amounts you've set. Tap one for its month-by-month forecast.";

export function AccountsProgress({ onOpen }: { onOpen: (key: AccountKey) => void }) {
  const t = useTheme();
  const { state, result, forecast, start, whatIfOn } = usePlan();
  const openPage = useOpenPage();
  const txns = useStore((s) => s.txns);
  const d = result.d;
  const pl = forecast;
  const fc = accountForecasts(state, d, pl, d.r);
  const y0 = start.getFullYear();
  const when = (m: number | undefined) => (m === undefined ? undefined : m <= 0 ? "this month" : monthLabel(start, m));
  const ev = (key: string) => pl.events.find((e) => e.key === key)?.m;
  const coastM = result.crossing === null ? null : Math.round(result.crossing * 12);
  const c = state.contributed && state.contributed.year === y0 ? state.contributed : undefined;
  const real = { ...result, plan: pl };
  const tipFor = (step: "k401" | "hsa") => {
    if (!state.plan.steps.includes(step)) return undefined;
    const info = stepInfo(step, state, real, start);
    const first = info?.meta.split(" · ")[0];
    return first && /^From /.test(first) ? first : undefined;
  };

  // the month to look ahead to (default: December this year)
  const defaultAt = 11 - start.getMonth();
  const [at, setAt] = useState(defaultAt);
  const [tip, setTip] = useState(false);
  const last = pl.months.length - 1;
  const atI = Math.max(0, Math.min(at, last));
  const dec = pl.months[atI]!;
  const selY = dec.y;
  const selLabel = monthLabel(start, atI);
  const rows: Row[] = [];
  // emergency fund
  if (pl.fullTarget > 0) {
    const cash = d.bal.cash;
    const full = cash >= pl.fullTarget - 0.5;
    rows.push({
      key: "cash",
      name: "Emergency fund",
      value: `${money(cash)} of ${money(pl.fullTarget, { whole: true })}`,
      progress: Math.min(1, cash / pl.fullTarget),
      later: dec ? Math.min(1, dec.cash / pl.fullTarget) : undefined,
      status: full ? "Full" : ev("fullEF") !== undefined ? `Full by ${when(ev("fullEF"))}` : "Not full in the plan yet",
      info: `${state.plan.efMonths} months of expenses (${money(pl.fullTarget / Math.max(1, state.plan.efMonths), { whole: true })} a month), kept in cash. By ${selLabel}: ${money(dec.cash, { whole: true })}.`,
      color: t.good,
      done: full,
    });
  }
  // accounts with a yearly limit
  const spIra = fc.some((x) => x.key === "iraSpouse");
  const maxedIn = (k: "k401" | "hsa" | "ira" | "iraSpouse") => (k === "iraSpouse" ? pl.maxedYears.iraSpouse ?? [] : pl.maxedYears[k]);
  for (const k of ["k401", "hsa", "ira", "iraSpouse"] as const) {
    const a = fc.find((x) => x.key === k);
    if (!a) continue;
    const yr = a.years.find((y) => y.year === y0);
    const yrSel = a.years.find((y) => y.year === selY);
    if (!yr?.limit || !yrSel?.limit) continue;
    const before = start.getMonth() === 0 ? 0 : k === "k401" ? c?.k401 ?? pl.ytdBefore?.k401 ?? 0 : k === "hsa" ? c?.hsa ?? pl.ytdBefore?.hsa ?? 0 : k === "iraSpouse" ? c?.iraSpouse ?? 0 : c?.ira ?? 0;
    const yearIn = (k === "hsa" ? yr.total : yr.employee) + before;
    const maxed = yearIn >= yr.limit - 1;
    // the plan filled the room it sees, but it only counts this year from today (nothing entered for earlier months)
    const partYear = !maxed && maxedIn(k).includes(y0);
    // nothing entered for this year: the 401(k) / HSA assume earlier paychecks; the IRA assumes nothing
    const notEntered = start.getMonth() > 0 && !c;
    const nextYear = a.years.find((y) => y.year === y0 + 1);
    const nextMaxed = maxedIn(k).includes(y0 + 1);
    const nothing = yearIn < 0.5 && a.start < 0.5;
    if (nothing && !(nextYear && nextYear.total > 0.5)) continue;
    // what's really in so far this year: what you entered, plus transfers you've recorded into these accounts
    const ids = new Set(state.accounts.filter((x) => (isSpouseIra(state, x) ? "iraSpouse" : accountGroup(x)) === k).map((x) => x.id));
    const moved = txns
      .filter((x) => !x.deleted && x.date.startsWith(String(y0)) && ((x.transferAccountId && ids.has(x.transferAccountId) && x.amount < 0) || (x.categoryId && [...ids].some((id) => x.categoryId === "acct:" + id) && x.amount < 0)))
      .reduce((sum, x) => sum + Math.abs(x.amount), 0);
    const soFar = (k === "k401" ? c?.k401 ?? 0 : k === "hsa" ? c?.hsa ?? 0 : k === "iraSpouse" ? c?.iraSpouse ?? 0 : c?.ira ?? 0) + moved;
    // the plan, from January (or today) of the picked month's year through that month
    const thisYear = selY === y0;
    const byThen =
      (thisYear ? before : 0) +
      a.months.filter((x) => x.y === selY && x.m <= atI).reduce((sum, x) => sum + (k === "hsa" ? x.total : x.paycheck + x.plan), 0);
    const limitSel = yrSel.limit!;
    const fullThen = byThen >= limitSel - 1;
    rows.push({
      key: k,
      name: k === "iraSpouse" ? spouseIraLabel(state) : k === "ira" ? (spIra ? "Your IRA" : "IRA") : BUCKET_LABELS[k],
      value: thisYear ? `${money(soFar)} of ${money(limitSel, { whole: true })}` : `${selY}: ${money(limitSel, { whole: true })} limit`,
      progress: thisYear ? Math.min(1, soFar / limitSel) : 0,
      later: Math.min(1, byThen / limitSel),
      status: fullThen ? `Maxed by ${selLabel}` : `About ${money(byThen, { whole: true })} by ${selLabel}`,
      info: [
        thisYear ? `The bar is what's in so far this year, against the ${y0} limit.` : `${selY} starts fresh with a new limit.`,
        k === "k401" || (k === "hsa" && state.plan.hsaPayroll !== false) ? tipFor(k) : undefined,
        notEntered && thisYear
          ? k === "ira" || k === "iraSpouse"
            ? `Add what's already in for ${y0} (Money → Accounts) so the plan knows your real room.`
            : `Not entered yet, so the plan assumes about ${money(before, { whole: true })} from this year's earlier paychecks. Enter the real amount on Money → Accounts.`
          : undefined,
      ].filter(Boolean).join(" "),
      needs: notEntered && thisYear ? `Add what's in so far for ${y0} (Money → Accounts)` : undefined,
      color: t.series[k === "iraSpouse" ? "ira" : k],
      done: thisYear && maxed,
    });
  }
  // investments without a limit
  for (const k of ["taxable", "other"] as const) {
    const a = fc.find((x) => x.key === k);
    if (!a) continue;
    const later = coastM !== null && coastM > 0 ? a.months[Math.min(coastM, a.months.length - 1)]?.balance : undefined;
    const then = a.months[atI]?.balance ?? a.start;
    if (a.start < 0.5 && !(later && later > 0.5) && then < 0.5) continue;
    rows.push({
      key: k,
      name: k === "taxable" ? "Brokerage" : "Other investments",
      value: money(a.start),
      status: `About ${money(then, { whole: true })} by ${selLabel}`,
      info: later !== undefined ? `About ${money(later, { whole: true })} by your Coast FI date (${monthLabel(start, coastM!)}).` : undefined,
      color: k === "taxable" ? t.series.taxable : t.text3,
    });
  }
  // goals
  for (const g of state.goals.filter((x) => !x.recurring && x.target > 0)) {
    const done = g.saved >= g.target - 0.5;
    const m = ev("goal:" + g.id);
    rows.push({
      key: ("goal:" + g.id) as AccountKey,
      name: g.name || "Goal",
      value: `${money(g.saved)} of ${money(g.target, { whole: true })}`,
      progress: Math.min(1, g.saved / g.target),
      later: dec ? Math.min(1, (dec.goals.find((x) => x.id === g.id)?.saved ?? g.saved) / g.target) : undefined,
      status: done ? "Reached" : m !== undefined ? `Reached ${when(m)}` : "Not reached in the plan yet",
      color: t.series.goals,
      done,
    });
  }
  // debts
  for (const x of state.debts.filter((y) => y.balance > 0.5)) {
    const m = ev("debt:" + x.id);
    const owedThen = fc.find((y) => y.key === "debt:" + x.id)?.months[atI]?.balance ?? x.balance;
    rows.push({
      key: ("debt:" + x.id) as AccountKey,
      name: debtLabel(x),
      value: `${money(x.balance)} owed`,
      status:
        m !== undefined && m <= atI
          ? `Paid off ${when(m)}`
          : m !== undefined ? `Paid off ${when(m)}` : x.payroll ? "From your paycheck" : "Minimum payments",
      info: m !== undefined && m <= atI ? undefined : `By ${selLabel}: ${money(owedThen, { whole: true })} owed.`,
      progress: x.balance > 0 ? 0 : undefined,
      later: x.balance > 0 ? Math.min(1, Math.max(0, 1 - owedThen / x.balance)) : undefined,
      color: t.series.debt,
    });
  }
  // one link for the whole card, not one per account
  const needs = rows.find((r) => r.needs)?.needs;

  return (
    <Card padded={false}>
      <View style={{ padding: space.lg, paddingBottom: space.sm, gap: 2 }}>
        <View style={styles.pickRow}>
          <View style={[styles.pickRow, { gap: 4, flex: 1, minWidth: 0 }]}>
            <SectionLabel flush>Accounts filling up</SectionLabel>
            <InfoTip text={INFO} label="Accounts filling up" open={tip} onToggle={setTip} />
          </View>
          <View style={{ width: 136 }}>
            <Select
              label="Look ahead to"
              options={[0, 12, 24].map((n) => defaultAt + n).filter((to) => to <= last).map((to) => ({ value: String(to), label: monthLabel(start, to) }))}
              value={String(atI)}
              onChange={(v) => setAt(+v)}
            />
          </View>
        </View>
        {tip ? <InfoText text={INFO} /> : null}
        <View style={styles.key}>
          <View style={styles.keyItem}><View style={[styles.keySw, { backgroundColor: t.accent }]} /><Text style={[type.caption, { color: t.text3 }]}>In now</Text></View>
          <View style={styles.keyItem}><View style={[styles.keySw, { backgroundColor: t.accent, opacity: 0.35 }]} /><Text style={[type.caption, { color: t.text3 }]}>By {selLabel}, at your amounts</Text></View>
        </View>
        {needs ? (
          <Text role="link" style={[type.caption, { color: t.accent, fontWeight: "600" }]} onPress={() => openPage("/money/accounts")}>
            {needs.replace(/ \(Money → Accounts\)$/, "")} →
          </Text>
        ) : null}
      </View>
      {rows.map((r, i) => (
        <View key={r.key}>
          {i > 0 ? <View style={{ marginLeft: space.lg }}><Divider /></View> : null}
          <View style={styles.rowWrap}>
            <Pressable
              role="button"
              accessibilityLabel={`${r.name}: ${r.value}. ${r.status}. Open its forecast`}
              onPress={() => onOpen(r.key)}
              style={({ pressed }) => [styles.row, pressed ? { backgroundColor: t.surface2 } : null]}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <View style={styles.line}>
                  <View style={[styles.dot, { backgroundColor: r.color }]} />
                  <Text style={[type.body, { color: t.text, fontWeight: "600", flex: 1 }]} numberOfLines={1}>{r.name}</Text>
                  <Text style={[type.label, { color: t.text, fontVariant: ["tabular-nums"] }]}>{r.value}</Text>
                </View>
                {r.progress !== undefined ? <TwoBar now={r.progress} later={r.later} color={r.color} /> : null}
              </View>
              <Icon name="chevron" size={14} color={t.text3} />
            </Pressable>
            <View style={styles.statusWrap}>
              <RowStatus r={r} whatIf={whatIfOn} />
            </View>
          </View>
        </View>
      ))}
      {!rows.length ? <Text style={[type.caption, { color: t.text3, padding: space.lg }]}>Add your accounts and debts on the Money tab.</Text> : null}
    </Card>
  );
}

/** One line under the bar: how it's going, a nudge when something's missing, and an ⓘ with the rest. */
function RowStatus({ r, whatIf }: { r: Row; /** What-ifs are on: the forecast line is orange, like every number they change. */ whatIf?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <View style={[styles.line, { gap: 4 }]}>
        <Text style={[type.caption, { color: r.done ? t.good : whatIf ? t.warn : t.text3, fontWeight: r.done || whatIf ? "700" : "400", flexShrink: 1 }]} numberOfLines={1}>{r.status}</Text>
        {r.info ? <InfoTip text={r.info} label={r.name} open={open} onToggle={setOpen} /> : null}
      </View>
      {open && r.info ? <InfoText text={r.info} /> : null}
    </>
  );
}

/** Solid: what's there now. Lighter, behind it: where the plan has it by year end. */
export function TwoBar({ now, later, color }: { now: number; later?: number; color: string }) {
  const t = useTheme();
  const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10}%` as const;
  return (
    <View style={[styles.track, { backgroundColor: t.track }]} role="progressbar" aria-valuenow={Math.round(now * 100)} aria-valuemin={0} aria-valuemax={100}>
      {later !== undefined && later > now ? <View style={[styles.fill, { width: pct(later), backgroundColor: color, opacity: 0.35 }]} /> : null}
      <View style={[styles.fill, { width: pct(now), backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4, overflow: "hidden", position: "relative" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4 },
  key: { flexDirection: "row", gap: space.md, marginTop: 4, flexWrap: "wrap" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  keyItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  keySw: { width: 10, height: 10, borderRadius: 2 },
  rowWrap: { paddingBottom: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 6 },
  statusWrap: { paddingLeft: space.lg, paddingRight: space.lg + 22, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
