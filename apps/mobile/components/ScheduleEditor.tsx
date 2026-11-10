/**
 * An account's monthly plan, like a spreadsheet: "from Nov 2026: $1,500/mo → from Apr 2027: $3,500/mo".
 * Each amount runs from its month until the next change. Used on the Plan tab's account cards and on
 * the emergency fund goal (same setting, two places to see it).
 */
import { accountGroup, accountPlanKey, ACCOUNT_KEY, type Account, type PlanState, type ScheduleEntry } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { monthKey, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, MonthField, NumberInput } from "./form";
import { Icon } from "./Icon";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (key: string) => `${MON[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const sorted = (list: ScheduleEntry[]) => [...list].sort((a, b) => (a.from < b.from ? -1 : 1));

/** "Your plan: $1,500/mo from Nov 2026 → $3,500/mo from Apr 2027", or "follows your steps". */
export function scheduleSummary(list: ScheduleEntry[] | undefined): string {
  const xs = sorted(list ?? []);
  if (!xs.length) return "Your plan: follows your steps";
  return "Your plan: " + xs.map((e) => `${money(e.amount)}/mo from ${monthName(e.from)}`).join(" → ");
}

export function useSchedule(k: string) {
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const list = sorted(state.plan.schedule?.[k] ?? []);
  const set = (next: ScheduleEntry[] | undefined) =>
    update((p) => {
      const all = { ...(p.plan.schedule ?? {}) };
      if (next && next.length) all[k] = sorted(next);
      else delete all[k];
      p.plan.schedule = Object.keys(all).length ? all : undefined;
    });
  const oneOffs = state.plan.scheduleMonths?.[k] ?? {};
  /** One month only (undefined removes it). */
  const setMonth = (month: string, v: number | undefined) =>
    update((p) => {
      const all = { ...(p.plan.scheduleMonths ?? {}) };
      const row = { ...(all[k] ?? {}) };
      if (v === undefined) delete row[month];
      else row[month] = Math.max(0, v);
      if (Object.keys(row).length) all[k] = row;
      else delete all[k];
      p.plan.scheduleMonths = Object.keys(all).length ? all : undefined;
    });
  return { list, set, oneOffs, setMonth };
}

export function ScheduleEditor({ k, label, unit = "/mo", note, onCleared, perCheck, base, gross, value }: {
  k: string; label: string; unit?: string; note?: string; onCleared?: () => void;
  /**
   * An input that changes over time (pay, a cost): today's amount is the field it's under, so the
   * list holds only the changes after today, and nothing here is "savings".
   */
  value?: boolean;
  /** A paycheck amount (401(k), HSA): per check, set on the job, not from what's left. */
  perCheck?: boolean;
  /** What a new change starts at (today's per-check amount). */
  base?: number;
  /** Gross pay per check: lets a paycheck change be a % of pay. */
  gross?: number;
}) {
  const t = useTheme();
  const { start } = usePlan();
  const { list, set, oneOffs, setMonth } = useSchedule(k);
  const singles = Object.keys(oneOffs).sort();
  const last = list[list.length - 1];
  // the amount in effect this month
  const current = [...list].filter((e) => e.from <= monthKey(start)).pop();
  const nextFrom = last
    ? monthKey(new Date(Number(last.from.slice(0, 4)), Number(last.from.slice(5, 7)), 1))
    : value ? monthKey(new Date(start.getFullYear(), start.getMonth() + 1, 1)) : monthKey(start);
  const unitText = (u: string) => (u === "/mo" ? "/mo" : u);
  return (
    <View style={[styles.box, { backgroundColor: t.surface2 }]}>
      {value ? (
        <View style={[styles.row, !current ? { borderLeftWidth: 3, borderLeftColor: t.accent, paddingLeft: 6 } : null]}>
          <Text style={[type.caption, { color: t.text2, width: 36 }]}>Now</Text>
          <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(base ?? 0)}{unitText(unit)}</Text>
          <Text style={[type.caption, { color: t.text3 }]}>(the amount above)</Text>
        </View>
      ) : null}
      {list.map((e, n) => (
        <View key={e.from + n} style={[styles.row, e === current ? { borderLeftWidth: 3, borderLeftColor: t.accent, paddingLeft: 6 } : null]}>
          <Text style={[type.caption, { color: t.text2, width: 36 }]}>From</Text>
          <MonthField label={`${label}: change starts`} value={e.from} width={150} onChange={(v) => set(list.map((x, j) => (j === n ? { ...x, from: v } : x)))} />
          {e.pct !== undefined && gross ? (
            <>
              <NumberInput kind="percent" label={`${label} from ${monthName(e.from)}, % of pay`} value={e.pct} width={110} max={1} onChange={(v) => set(list.map((x, j) => (j === n ? { ...x, pct: v, amount: Math.round(gross * v * 100) / 100 } : x)))} />
              <Text style={[type.caption, { color: t.text3 }]}>of pay ≈ {money(gross * e.pct)}{unit}</Text>
            </>
          ) : (
            <>
              <NumberInput kind="money" label={`${label} from ${monthName(e.from)}`} value={e.amount} width={130} step={perCheck ? 25 : 100} onChange={(v) => set(list.map((x, j) => (j === n ? { ...x, amount: v } : x)))} />
              <Text style={[type.caption, { color: t.text3 }]}>{unit}</Text>
            </>
          )}
          {perCheck && gross ? (
            <Pressable
              role="button"
              accessibilityLabel={e.pct !== undefined ? "Use a dollar amount" : "Use a percent of pay"}
              onPress={() => set(list.map((x, j) => (j === n ? (x.pct !== undefined ? { from: x.from, amount: x.amount } : { ...x, pct: Math.round((x.amount / gross) * 1000) / 1000 }) : x)))}
              hitSlop={6}
              style={[styles.unitSwitch, { borderColor: t.border }]}
            >
              <Text style={[type.caption, { color: e.pct === undefined ? t.accent : t.text3, fontWeight: "700" }]}>$</Text>
              <Text style={[type.caption, { color: t.text3 }]}>/</Text>
              <Text style={[type.caption, { color: e.pct !== undefined ? t.accent : t.text3, fontWeight: "700" }]}>%</Text>
            </Pressable>
          ) : null}
          {e === current ? <Text style={[type.overline, { color: t.accent }]}>Now</Text> : null}
          <IconButton icon="trash" label={`Remove the change from ${monthName(e.from)}`} onPress={() => set(list.filter((_, j) => j !== n))} />
        </View>
      ))}
      {singles.length ? <Text style={[type.caption, { color: t.text3, marginTop: 4 }]}>Just one month</Text> : null}
      {singles.map((m) => (
        <View key={"one" + m} style={styles.row}>
          <Text style={[type.caption, { color: t.text2, width: 36 }]}>Only</Text>
          <MonthField label={`${label}: one month`} value={m} width={150} onChange={(v) => { if (v === m) return; const amt = oneOffs[m]!; setMonth(m, undefined); setMonth(v, amt); }} />
          <NumberInput kind="money" label={`${label} in ${monthName(m)} only`} value={oneOffs[m]!} width={130} step={100} onChange={(v) => setMonth(m, v)} />
          <Text style={[type.caption, { color: t.text3 }]}>{unit.replace("/mo", "")}</Text>
          <IconButton icon="trash" label={`Remove the ${monthName(m)} change`} onPress={() => setMonth(m, undefined)} />
        </View>
      ))}
      <View style={styles.row}>
        <Button title={list.length || value ? "Add a change" : perCheck ? "Change it from a month" : "Set a monthly amount"} icon="plus" onPress={() => set([...list, { from: nextFrom, amount: last?.amount ?? base ?? 0 }])} style={{ minHeight: 36 }} />
        {list.length || value ? (
          <Button
            title="Change one month"
            tone="ghost"
            onPress={() => {
              // the first month after today without its own change
              let d = new Date(start.getFullYear(), start.getMonth() + 1, 1);
              while (oneOffs[monthKey(d)] !== undefined) d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
              setMonth(monthKey(d), list.filter((e) => e.from <= monthKey(d)).pop()?.amount ?? base ?? 0);
            }}
            style={{ minHeight: 36 }}
          />
        ) : null}
        {list.length || singles.length ? <Button title={value ? "Remove all changes" : perCheck ? "Same every paycheck" : "Follow my steps instead"} tone="ghost" onPress={() => { set(undefined); singles.forEach((m) => setMonth(m, undefined)); onCleared?.(); }} style={{ minHeight: 36 }} /> : null}
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>
        {value
          ? "Today's amount stays until your first change. Each change lasts until the next one; a one-month change applies to that month only. Use today's dollars (the plan adds no inflation)."
          : perCheck
          ? "Each amount is per paycheck, from its month until your next change; a one-month change applies to that month only. Use $0 to pause. Putting in less comes back as take-home (after tax if pre-tax); putting in more comes out of it."
          : "Each amount runs from its month until your next change; a one-month change applies to that month only. It goes in before your other steps, if there's that much left after your budget. Use $0 to stop."}
        {note ? ` ${note}` : ""}{perCheck || value ? "" : " Shows as savings on your budget."}
      </Text>
    </View>
  );
}

/**
 * Where an account's monthly contribution is set: its own key ("acct:<id>", added up by kind in the
 * plan), "payroll" for the 401(k) and a paycheck HSA (set per check on the job), or null (property,
 * accounts the plan skips).
 */
export function contributionKey(s: PlanState, a: Pick<Account, "id" | "name" | "type" | "counts">): string | "payroll" | null {
  const g = accountGroup(a);
  if (!g || g === "other") return null;
  if (g === "k401") return "payroll";
  if (g === "hsa" && s.plan.hsaPayroll !== false) return "payroll";
  return accountPlanKey(s, a) ? ACCOUNT_KEY + a.id : null;
}

/** This month's planned amount for a key, or undefined when it follows the plan steps. */
export function plannedNow(s: PlanState, k: string, month: string): number | undefined {
  const one = s.plan.scheduleMonths?.[k]?.[month];
  if (one !== undefined) return one;
  const list = sorted(s.plan.schedule?.[k] ?? []).filter((e) => e.from <= month);
  return list.length ? list[list.length - 1]!.amount : undefined;
}

/**
 * The short version: "Contributing [$500] a month". Changes over time (and single months) open the full
 * editor. No amount = the account gets whatever your priority order gives it.
 */
export function MonthlyAmount({ k, label, unit = "a month", note, shared }: { k: string; label: string; unit?: string; note?: string; shared?: string }) {
  const t = useTheme();
  const { start } = usePlan();
  const { list, set, oneOffs } = useSchedule(k);
  const [more, setMore] = useState(false);
  const now = monthKey(start);
  const singles = Object.keys(oneOffs).length;
  const simple = list.length === 1 && !singles;
  const first = list[0];
  return (
    <View style={{ gap: 6 }}>
      {!list.length && !singles ? (
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={[type.caption, { color: t.text3, flex: 1, minWidth: 160 }]}>Monthly contribution: not set, so it gets whatever your priority order gives it.</Text>
          <Button title="Set an amount" icon="plus" onPress={() => set([{ from: now, amount: 0 }])} style={{ minHeight: 36 }} />
        </View>
      ) : simple && first ? (
        <View style={styles.row}>
          <Text style={[type.caption, { color: t.text2, fontWeight: "600" }]}>Contributing</Text>
          <NumberInput kind="money" label={`${label} monthly contribution`} value={first.amount} width={120} step={50} onChange={(v) => set([{ ...first, amount: v }])} />
          <Text style={[type.caption, { color: t.text3 }]}>{unit === "a month" ? "/mo" : unit}{first.from > now ? ` from ${monthName(first.from)}` : ""}</Text>
          <IconButton icon="close" label={`Stop setting ${label} by hand`} onPress={() => set(undefined)} />
        </View>
      ) : (
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>
          {list.length ? scheduleSummary(list).replace("Your plan: ", "Contributing ") : "One-month changes only"}
          {singles ? ` · ${singles} one-month change${singles === 1 ? "" : "s"}` : ""}
        </Text>
      )}
      {shared ? <Text style={[type.caption, { color: t.text3 }]}>{shared}</Text> : null}
      {list.length || singles ? (
        <Pressable role="button" aria-expanded={more} onPress={() => setMore((v) => !v)} hitSlop={6} style={styles.link}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{more ? "Hide changes" : "Change it later or for one month"}</Text>
          <View style={{ transform: [{ rotate: more ? "90deg" : "0deg" }] }}>
            <Icon name="chevron" size={12} color={t.accent} />
          </View>
        </Pressable>
      ) : null}
      {more ? <ScheduleEditor k={k} label={label} unit={unit === "a month" ? "/mo" : unit} note={note} onCleared={() => setMore(false)} /> : null}
    </View>
  );
}

/**
 * A job's 401(k) or HSA per paycheck, changed by month: "$0/check from Nov 2026 → $860/check from Jan 2027".
 * Without changes it's the amount above, every paycheck.
 */
export function PaycheckChanges({ k, label, base, gross }: { k: string; label: string; base: number; gross?: number }) {
  const t = useTheme();
  const { list, oneOffs } = useSchedule(k);
  const [open, setOpen] = useState(false);
  const singles = Object.keys(oneOffs).length;
  const text = list.length
    ? list.map((e) => `${e.pct !== undefined && gross ? `${+(e.pct * 100).toFixed(2)}% of pay` : money(e.amount)}/check from ${monthName(e.from)}`).join(" → ").replace(/% of pay\/check/g, "% of pay") + (singles ? ` · ${singles} one-month change${singles === 1 ? "" : "s"}` : "")
    : singles ? `${singles} one-month change${singles === 1 ? "" : "s"}` : base > 0 ? "Same every paycheck. Pausing or changing it later?" : "Starting it later? Set it by month";
  return (
    <View style={{ gap: 6 }}>
      <Pressable role="button" aria-expanded={open} onPress={() => setOpen((v) => !v)} hitSlop={6} style={styles.link}>
        <Text style={[type.caption, { color: list.length || singles ? t.accent : t.text3, fontWeight: "700", flexShrink: 1 }]}>{text}</Text>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}> {open ? "Hide" : list.length || singles ? "Change" : "Change by month"}</Text>
        <Icon name="chevron" size={12} color={t.accent} />
      </Pressable>
      {open ? <ScheduleEditor k={k} label={label} unit="/check" perCheck base={base} gross={gross && gross > 0 ? gross : undefined} /> : null}
      {open && !(gross && gross > 0) ? <Text style={[type.caption, { color: t.text3 }]}>Add this job's gross pay per check to set changes as a % of pay.</Text> : null}
    </View>
  );
}

/**
 * "Changes later?" under an amount (pay, a deduction, a bill): opens the list of changes, and says
 * what's coming when there are some ("$3,300/check from Jan 2027").
 */
export function ChangesLater({ k, label, base, unit = "/mo", note, prompt = "Changes later?" }: {
  k: string; label: string; base: number; unit?: string; note?: string; prompt?: string;
}) {
  const t = useTheme();
  const { list, oneOffs } = useSchedule(k);
  const [open, setOpen] = useState(false);
  const singles = Object.keys(oneOffs).length;
  const any = list.length > 0 || singles > 0;
  const text = any
    ? [list.map((e) => `${money(e.amount)}${unit} from ${monthName(e.from)}`).join(" → "), singles ? `${singles} one-month change${singles === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")
    : prompt;
  return (
    <View style={{ gap: 6 }}>
      <Pressable role="button" aria-expanded={open} accessibilityLabel={`${label}: ${text}`} onPress={() => setOpen((v) => !v)} hitSlop={6} style={styles.link}>
        <Text style={[type.caption, { color: any ? t.accent : t.text3, fontWeight: "700", flexShrink: 1 }]}>{text}</Text>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}> {open ? "Hide" : any ? "Change" : "Set it by month"}</Text>
        <Icon name="chevron" size={12} color={t.accent} />
      </Pressable>
      {open ? <ScheduleEditor k={k} label={label} unit={unit} base={base} note={note} value onCleared={() => setOpen(false)} /> : null}
    </View>
  );
}

/** For accounts set per paycheck: says so, with a link to the job. */
export function PayrollNote({ what }: { what: string }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <Pressable role="link" onPress={() => router.push("/money/income")} hitSlop={6} style={styles.link}>
      <Text style={[type.caption, { color: t.accent, fontWeight: "700", flexShrink: 1 }]}>{what} contributions are set per paycheck on your job (Income)</Text>
      <Icon name="chevron" size={12} color={t.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  unitSwitch: { flexDirection: "row", gap: 3, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  box: { borderRadius: radius.md, padding: space.sm, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
});
