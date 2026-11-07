/**
 * Every account the plan adds to, like a spreadsheet: what goes in each month (and from where), this
 * year against the limit, and the balance ahead. Each account can have its own schedule ("from Apr 2027:
 * $3,500 a month"), and any single month can be changed. Cards or a table, same numbers.
 */
import { accountForecasts, BUCKET_LABELS, scheduleAmount, type AccountForecast, type AccountKey, type PlanState, type RunResult, type ScheduleEntry } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { debtLabel } from "../lib/debts";
import { money, monthLabel } from "../lib/format";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, MonthField, NumberInput, Segmented } from "./form";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressRing";
import { Card, Divider, SectionLabel } from "./ui";

type Props = { state: PlanState; o: RunResult; start: Date };

const ym = (start: Date, m: number) => {
  const dt = new Date(start.getFullYear(), start.getMonth() + m, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (key: string) => `${MON[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

export function AccountsForecast({ state, o, start }: Props) {
  const t = useTheme();
  const update = useStore((s) => s.update);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [open, setOpen] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState<string | null>(null);
  const [span, setSpan] = useState(12);
  const [edit, setEdit] = useState<{ k: AccountKey; i: number } | null>(null);
  const pl = o.plan;
  const d = o.d;
  const all = accountForecasts(state, d, pl, d.r);
  const schedule = state.plan.schedule ?? {};
  const oneOffs = state.plan.scheduleMonths ?? {};
  const coastM = o.crossing === null ? null : Math.round(o.crossing * 12);
  const retireM = Math.min(pl.months.length, d.years * 12) - 1;
  const thisMonth = ym(start, 0);

  const payrollHsa = state.plan.hsaPayroll !== false;
  /** Accounts you can put on a schedule (the 401(k) and a paycheck HSA are set per paycheck). */
  const schedulable = (k: AccountKey) => k !== "k401" && k !== "other" && !(k === "hsa" && payrollHsa);
  const label = (k: AccountKey) => {
    if (k === "cash") return "Cash (emergency fund)";
    if (k.startsWith("debt:")) {
      const x = state.debts.find((y) => "debt:" + y.id === k);
      return x ? `${debtLabel(x)} (what you owe)` : "Debt";
    }
    if (k.startsWith("goal:")) return `Goal: ${state.goals.find((g) => "goal:" + g.id === k)?.name ?? "Goal"}`;
    if (k === "ira") return "IRA";
    if (k === "other") return "Other investments";
    return BUCKET_LABELS[k as "k401" | "hsa" | "taxable"];
  };

  /* ---------- changing the schedule ---------- */
  const sorted = (list: ScheduleEntry[]) => [...list].sort((a, b) => (a.from < b.from ? -1 : 1));
  const setEntries = (k: AccountKey, list: ScheduleEntry[] | undefined) =>
    update((p) => {
      const next = { ...(p.plan.schedule ?? {}) };
      if (list && list.length) next[k] = sorted(list);
      else delete next[k];
      p.plan.schedule = Object.keys(next).length ? next : undefined;
    });
  const setOneOff = (k: AccountKey, month: string, v: number | undefined) =>
    update((p) => {
      const next = { ...(p.plan.scheduleMonths ?? {}) };
      const row = { ...(next[k] ?? {}) };
      if (v === undefined) delete row[month];
      else row[month] = Math.max(0, v);
      if (Object.keys(row).length) next[k] = row;
      else delete next[k];
      p.plan.scheduleMonths = Object.keys(next).length ? next : undefined;
    });
  /** From this month on (until your next change): replaces an entry on the same month. */
  const setFrom = (k: AccountKey, month: string, v: number) => {
    const list = (schedule[k] ?? []).filter((e) => e.from !== month);
    setEntries(k, [...list, { from: month, amount: Math.max(0, v) }]);
    if (oneOffs[k]?.[month] !== undefined) setOneOff(k, month, undefined);
  };
  const planText = (k: AccountKey) => {
    const list = sorted(schedule[k] ?? []);
    if (!list.length) return "Your plan: follows your steps";
    return "Your plan: " + list.map((e) => `${money(e.amount)}/mo from ${monthName(e.from)}`).join(" → ");
  };

  // show accounts that have money or get some in the next two years
  const shown = all.filter((a) => a.start > 0.5 || a.months.slice(0, 24).some((m) => m.total > 0.5) || (schedule[a.key]?.length ?? 0) > 0);
  const isDebt = (k: AccountKey) => k.startsWith("debt:");
  const m0 = all.reduce(
    (s, a) => (isDebt(a.key) ? s : { pay: s.pay + a.months[0]!.paycheck, plan: s.plan + a.months[0]!.plan, emp: s.emp + a.months[0]!.employer }),
    { pay: 0, plan: 0, emp: 0 },
  );
  const debtExtra = all.filter((a) => isDebt(a.key)).reduce((s, a) => s + a.months[0]!.plan, 0);
  const pieces = [m0.pay > 0.5 ? `${money(m0.pay)} from your paychecks` : "", m0.plan > 0.5 ? `${money(m0.plan)} from what's left` : "", m0.emp > 0.5 ? `${money(m0.emp)} from employers` : ""].filter(Boolean);

  const parts = (m: { paycheck: number; plan: number; employer: number }, k: AccountKey) =>
    [
      m.paycheck > 0.5 ? `${money(m.paycheck)} from your paychecks` : "",
      m.plan > 0.5 ? `${m.paycheck > 0.5 ? "+" : ""}${money(m.plan)} ${k === "k401" || (k === "hsa" && payrollHsa) ? "more per check from the plan" : "from what's left"}` : "",
      m.employer > 0.5 ? `${money(m.employer)} from your employer` : "",
    ].filter(Boolean).join(" · ");

  const editorFor = (k: AccountKey, i: number) => {
    const a = all.find((x) => x.key === k)!;
    const month = ym(start, i);
    const own = oneOffs[k]?.[month];
    return (
      <MonthEditor
        key={k + month}
        title={`${label(k)} · ${monthLabel(start, i)}`}
        unit={isDebt(k) ? "extra a month" : "a month"}
        initial={own ?? scheduleAmount(state.plan, k, month) ?? a.months[i]!.plan}
        changed={own !== undefined}
        onJust={(v) => { setOneOff(k, month, v); setEdit(null); }}
        onFrom={(v) => { setFrom(k, month, v); setEdit(null); }}
        onUndo={() => { setOneOff(k, month, undefined); setEdit(null); }}
        onCancel={() => setEdit(null)}
      />
    );
  };

  /** Tappable amount for a month (plain text for paycheck-set accounts). */
  const amountCell = (a: AccountForecast, i: number, width: number) => {
    const k = a.key;
    const m = a.months[i]!;
    const month = ym(start, i);
    const changed = oneOffs[k]?.[month] !== undefined;
    const value = isDebt(k) ? m.paycheck + m.plan : m.total;
    if (!schedulable(k))
      return <Text style={[type.caption, { color: t.text, width, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{money(value)}</Text>;
    return (
      <Pressable role="button" accessibilityLabel={`Change ${label(k)} for ${monthLabel(start, i)}`} onPress={() => setEdit(edit && edit.k === k && edit.i === i ? null : { k, i })} hitSlop={4} style={{ width, alignItems: "flex-end" }}>
        <Text style={[type.caption, { color: changed ? t.accent : t.text, fontWeight: changed ? "700" : "500", fontVariant: ["tabular-nums"], textDecorationLine: "underline", textDecorationColor: t.border }]}>{money(value)}</Text>
      </Pressable>
    );
  };

  /* ---------- the schedule editor on a card ---------- */
  const scheduleEditor = (k: AccountKey) => {
    const list = sorted(schedule[k] ?? []);
    const last = list[list.length - 1];
    const nextFrom = last ? ym(new Date(Number(last.from.slice(0, 4)), Number(last.from.slice(5, 7)) - 1, 1), 1) : thisMonth;
    return (
      <View style={[styles.sched, { backgroundColor: t.surface2 }]}>
        {list.map((e, n) => (
          <View key={e.from + n} style={styles.editRow}>
            <Text style={[type.caption, { color: t.text2, width: 36 }]}>From</Text>
            <MonthField label={`${label(k)}: change starts`} value={e.from} width={150} onChange={(v) => setEntries(k, list.map((x, j) => (j === n ? { ...x, from: v } : x)))} />
            <NumberInput kind="money" label={`${label(k)} from ${monthName(e.from)}`} value={e.amount} width={130} step={100} onChange={(v) => setEntries(k, list.map((x, j) => (j === n ? { ...x, amount: v } : x)))} />
            <Text style={[type.caption, { color: t.text3 }]}>{isDebt(k) ? "extra/mo" : "/mo"}</Text>
            <IconButton icon="trash" label={`Remove the change from ${monthName(e.from)}`} onPress={() => setEntries(k, list.filter((_, j) => j !== n))} />
          </View>
        ))}
        <View style={styles.editRow}>
          <Button title={list.length ? "Add a change" : "Set a monthly amount"} icon="plus" onPress={() => setEntries(k, [...list, { from: nextFrom, amount: last?.amount ?? 0 }])} style={{ minHeight: 36 }} />
          {list.length ? <Button title="Follow my steps instead" tone="ghost" onPress={() => { setEntries(k, undefined); setPlanOpen(null); }} style={{ minHeight: 36 }} /> : null}
        </View>
        <Text style={[type.caption, { color: t.text3 }]}>
          Each amount runs from its month until your next change. It goes in before your other steps, if there's that much left after your budget. Use $0 to stop.
          {k === "cash" ? " Cash can go past your emergency fund goal if you plan it." : ""} Shows as savings on your budget.
        </Text>
      </View>
    );
  };

  /* ---------- a card per account ---------- */
  const card = (a: AccountForecast) => {
    const k = a.key;
    const m0a = a.months[0]!;
    const isOpen = open === k;
    const debt = isDebt(k);
    const y0 = start.getFullYear();
    const thisYear = a.years.find((y) => y.year === y0);
    const c = state.contributed && state.contributed.year === y0 ? state.contributed : undefined;
    const before = start.getMonth() === 0 ? 0 : k === "k401" ? c?.k401 ?? pl.ytdBefore?.k401 ?? 0 : k === "hsa" ? c?.hsa ?? pl.ytdBefore?.hsa ?? 0 : k === "ira" ? c?.ira ?? 0 : 0;
    const yearIn = thisYear ? (k === "hsa" ? thisYear.total : thisYear.employee) + before : 0;
    const guessed = start.getMonth() > 0 && !c && (k === "k401" || k === "hsa" || k === "ira");
    const at = (m: number) => a.months[Math.max(0, Math.min(a.months.length - 1, m))]!.balance;
    const points: { label: string; v: number }[] = [{ label: "Today", v: a.start }, { label: "In 1 year", v: at(11) }];
    if (a.invested) {
      if (coastM !== null && coastM > 12) points.push({ label: `Coast FI (${monthLabel(start, coastM)})`, v: at(coastM) });
      points.push({ label: `At ${d.retireAge}`, v: at(retireM) });
    }
    const paidOff = debt ? a.months.findIndex((m) => m.balance <= 0.5) : -1;
    const rows = a.months.slice(0, span);
    const many = a.accounts.length > 1 || (a.accounts.length === 1 && a.accounts[0]!.name.trim() && a.accounts[0]!.name.trim() !== label(k));
    return (
      <View key={k}>
        <View style={{ padding: space.lg, gap: 6 }}>
          <Text style={[type.body, { color: t.text, fontWeight: "700" }]}>{label(k)}</Text>
          {many ? (
            <Text style={[type.caption, { color: t.text3 }]}>
              Today is {a.accounts.map((x) => `${x.name.trim() || "Unnamed account"} ${money(x.balance)}`).join(" + ")}.{k === "cash" ? "" : " Wrong account here? Change what it counts as under Money → Accounts."}
            </Text>
          ) : null}
          {schedulable(k) ? (
            <>
              <Pressable role="button" aria-expanded={planOpen === k} onPress={() => setPlanOpen(planOpen === k ? null : k)} hitSlop={6} style={styles.link}>
                <Text style={[type.caption, { color: schedule[k]?.length ? t.accent : t.text3, fontWeight: "700", flexShrink: 1 }]}>{planText(k)}</Text>
                <View style={{ transform: [{ rotate: planOpen === k ? "90deg" : "0deg" }] }}>
                  <Icon name="chevron" size={12} color={t.text3} />
                </View>
              </Pressable>
              {planOpen === k ? scheduleEditor(k) : null}
            </>
          ) : null}
          <Text style={[type.caption, { color: t.text2 }]}>
            <Text style={{ color: t.text, fontWeight: "600" }}>This month: {debt ? `${money(m0a.paycheck + m0a.plan)} paid` : money(m0a.total)}</Text>
            {m0a.total > 0.5 && !debt && k !== "cash" ? ` (${parts(m0a, k)})` : ""}
            {debt && m0a.paycheck + m0a.plan > 0.5 ? ` (${money(m0a.paycheck)} minimum${state.debts.find((x) => "debt:" + x.id === k)?.payroll ? " from your paychecks" : ""}${m0a.plan > 0.5 ? ` + ${money(m0a.plan)} extra` : ""})` : ""}
            {m0a.total <= 0.5 ? (() => { const f = a.months.findIndex((m) => m.total > 0.5); return f > 0 ? ` · starts ${monthLabel(start, f)}` : ""; })() : ""}
          </Text>
          {thisYear?.limit ? (
            <View style={{ gap: 4, maxWidth: 360 }}>
              <Text style={[type.caption, { color: t.text2 }]}>
                {y0}: {money(yearIn)} of the {money(thisYear.limit)} limit{k === "hsa" ? " (yours + employer's)" : ""}
                {guessed ? (k === "ira" ? " · add what you've put in this year (Money → Accounts)" : " · counts this year's earlier paychecks at today's amounts") : ""}
              </Text>
              <ProgressBar progress={Math.min(1, yearIn / thisYear.limit)} color={t.good} />
            </View>
          ) : null}
          <View style={styles.points}>
            {points.map((p) => (
              <View key={p.label} style={{ minWidth: 92 }}>
                <Text style={[type.caption, { color: t.text3 }]}>{p.label}</Text>
                <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(p.v)}</Text>
              </View>
            ))}
            {paidOff >= 0 ? (
              <View style={{ minWidth: 92 }}>
                <Text style={[type.caption, { color: t.text3 }]}>Paid off</Text>
                <Text style={[type.label, { color: t.good, fontWeight: "700" }]}>{paidOff === 0 ? "This month" : monthLabel(start, paidOff)}</Text>
              </View>
            ) : null}
          </View>
          <Pressable role="button" aria-expanded={isOpen} onPress={() => { setOpen(isOpen ? null : k); setEdit(null); }} hitSlop={6} style={styles.link}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{isOpen ? "Hide months" : "Month by month"}</Text>
            <View style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}>
              <Icon name="chevron" size={14} color={t.accent} />
            </View>
          </Pressable>
          {isOpen ? (
            <View style={[styles.sched, { backgroundColor: t.surface2 }]}>
              <View style={styles.row}>
                <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Month</Text>
                <Text style={[type.overline, { color: t.text3, width: 100, textAlign: "right" }]}>{debt ? "Paid" : "In"}</Text>
                <Text style={[type.overline, { color: t.text3, width: 110, textAlign: "right" }]}>{debt ? "Still owed" : "Balance"}</Text>
              </View>
              {rows.map((m, i) => (
                <View key={m.m} style={{ gap: 4 }}>
                  <View style={styles.row}>
                    <Text style={[type.caption, { color: i === 0 ? t.text : t.text2, flex: 1, fontWeight: i === 0 ? "700" : "400" }]}>
                      {i === 0 ? `This month (${monthLabel(start, 0)})` : monthLabel(start, m.m)}
                      {pl.months[i]!.extraCheck ? <Text style={{ color: t.text3 }}> · 3 paychecks</Text> : null}
                      {oneOffs[k]?.[ym(start, i)] !== undefined ? <Text style={{ color: t.accent }}> · changed</Text> : null}
                    </Text>
                    {amountCell(a, i, 100)}
                    <Text style={[type.caption, { color: t.text2, width: 110, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{money(m.balance)}</Text>
                  </View>
                  {edit && edit.k === k && edit.i === i ? editorFor(k, i) : null}
                </View>
              ))}
              <View style={styles.editRow}>
                {[12, 24, 36].map((n) => (
                  <Pressable key={n} role="button" onPress={() => setSpan(n)} hitSlop={6}>
                    <Text style={[type.caption, { color: span === n ? t.text : t.accent, fontWeight: "700" }]}>{n} months</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[type.caption, { color: t.text3 }]}>
                {schedulable(k)
                  ? "Tap an amount to change that month, or from that month on."
                  : "Set per paycheck, so it's steady. Change it on your job (Money → Income) or with the order of your steps."}
                {k === "cash" ? " Cash also collects anything not given to a step." : ""}
                {a.invested ? ` Balances grow at your assumed ${(d.r * 100).toFixed(1)}% return after inflation.` : ""}
              </Text>
            </View>
          ) : null}
        </View>
        <Divider />
      </View>
    );
  };

  /* ---------- the table: months down, accounts across ---------- */
  const COL = 108;
  const table = (
    <View style={{ padding: space.md, gap: space.sm }}>
      <ScrollView horizontal>
        <View>
          <View style={[styles.tr, { borderBottomColor: t.border }]}>
            <Text style={[type.overline, styles.monthCol, { color: t.text3 }]}>Month</Text>
            {shown.map((a) => (
              <Text key={a.key} numberOfLines={2} style={[type.overline, { color: t.text3, width: COL * 2, textAlign: "center" }]}>{label(a.key).replace(" (what you owe)", "")}</Text>
            ))}
          </View>
          <View style={[styles.tr, { borderBottomColor: t.border }]}>
            <Text style={[type.caption, styles.monthCol, { color: t.text3 }]}>Today</Text>
            {shown.map((a) => (
              <View key={a.key} style={{ flexDirection: "row", width: COL * 2 }}>
                <Text style={[type.caption, { color: t.text3, width: COL, textAlign: "right" }]}>{" "}</Text>
                <Text style={[type.caption, { color: t.text2, width: COL, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{money(a.start)}</Text>
              </View>
            ))}
          </View>
          {Array.from({ length: span }, (_, i) => (
            <View key={i} style={[styles.tr, { borderBottomColor: t.border }]}>
              <Text style={[type.caption, styles.monthCol, { color: i === 0 ? t.text : t.text2, fontWeight: i === 0 ? "700" : "400" }]}>
                {monthLabel(start, i)}
                {pl.months[i]!.extraCheck ? " ·3" : ""}
              </Text>
              {shown.map((a) => (
                <View key={a.key} style={{ flexDirection: "row", width: COL * 2 }}>
                  {amountCell(a, i, COL)}
                  <Text style={[type.caption, { color: t.text2, width: COL, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{money(a.months[i]!.balance)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {edit ? editorFor(edit.k, edit.i) : null}
      <View style={styles.editRow}>
        {[12, 24, 36].map((n) => (
          <Pressable key={n} role="button" onPress={() => setSpan(n)} hitSlop={6}>
            <Text style={[type.caption, { color: span === n ? t.text : t.accent, fontWeight: "700" }]}>{n} months</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>
        Each account: what goes in that month, then the balance (for debts: what you pay, then what's still owed). Tap an amount to change it. "·3" is a 3-paycheck month.
      </Text>
    </View>
  );

  return (
    <Card padded={false}>
      <View style={{ padding: space.lg, paddingBottom: space.md, gap: space.sm }}>
        <SectionLabel>Accounts</SectionLabel>
        <Text style={[type.body, { color: t.text2 }]}>
          Going in this month: <Text style={{ color: t.text, fontWeight: "700" }}>{money(m0.pay + m0.plan + m0.emp)}</Text>
          {pieces.length ? ` (${pieces.join(" · ")})` : ""}
          {debtExtra > 0.5 ? `, plus ${money(debtExtra)} extra on debt` : ""}. Give an account its own monthly plan, or change any month.
        </Text>
        <Segmented label="Show accounts as" options={[{ value: "cards", label: "Cards" }, { value: "table", label: "Table" }]} value={view} onChange={(v) => { setView(v); setEdit(null); }} />
      </View>
      <Divider />
      {view === "table" ? table : shown.map(card)}
    </Card>
  );
}

/** One month's amount: this month only, or from this month on (until your next change). */
function MonthEditor({ title, unit, initial, changed, onJust, onFrom, onUndo, onCancel }: {
  title: string; unit: string; initial: number; changed: boolean;
  onJust: (v: number) => void; onFrom: (v: number) => void; onUndo: () => void; onCancel: () => void;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState(initial);
  return (
    <View style={[styles.editor, { backgroundColor: t.surface, borderColor: t.accent }]}>
      <Text style={[type.caption, { color: t.text, fontWeight: "700" }]}>{title}</Text>
      <View style={styles.editRow}>
        <NumberInput kind="money" label={title} value={draft} width={140} step={100} onChange={setDraft} />
        <Text style={[type.caption, { color: t.text3 }]}>{unit}</Text>
      </View>
      <View style={styles.editRow}>
        <Button title="Just this month" tone="primary" onPress={() => onJust(draft)} style={{ minHeight: 36 }} />
        <Button title="From this month on" onPress={() => onFrom(draft)} style={{ minHeight: 36 }} />
        {changed ? <Button title="Undo this month" tone="ghost" onPress={onUndo} style={{ minHeight: 36 }} /> : null}
        <Button title="Cancel" tone="ghost" onPress={onCancel} style={{ minHeight: 36 }} />
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>
        It gets this first that month (if there's that much left after your budget); the rest goes to your other steps.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  points: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, marginTop: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  sched: { borderRadius: radius.md, padding: space.sm, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 2 },
  editRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  editor: { borderWidth: 1, borderRadius: radius.md, padding: space.sm, gap: space.sm },
  tr: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 5 },
  monthCol: { width: 92 },
});
