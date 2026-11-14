import { type MonthRow } from "@coastfi/engine";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { InfoText, InfoTip } from "./form";
import { Card, Divider, Pill, SectionLabel } from "./ui";
import { money, monthLabel } from "../lib/format";
import { spouseIraLabel } from "../lib/spouse";
import { hsaTakeHome, monthTodos, shortfallText, usePlan } from "../lib/plan";
import { space, type, useTheme, type Theme } from "../lib/theme";

type Seg = { key: string; label: string; value: number; color: string };

/** Where a month's take-home goes (pre-tax payroll is already out of take-home). */
function splits(m: MonthRow, t: Theme, mt: number, rothShare = 0, hsaPayroll = false): Seg[] {
  const a = m.alloc;
  const segs: Seg[] = [{ key: "spend", label: "Budget + debt minimums", value: m.expenses - m.adjExpense - m.setAside, color: t.track }];
  if (m.setAside > 0.5) segs.push({ key: "setaside", label: "Set aside for repeating bills", value: m.setAside, color: t.series.goals });
  if (m.adjExpense > 0.5) segs.push({ key: "oneoff", label: "One-off expenses", value: m.adjExpense, color: t.warn });
  const matchTH = a.k401TakeHome - a.k401Step;
  if (matchTH > 0.5) segs.push({ key: "match", label: `401(k) up to the full match`, value: matchTH, color: t.series.k401 });
  if (a.k401Step > 0.5) segs.push({ key: "k401", label: "Extra 401(k)", value: a.k401Step, color: t.series.k401 });
  if (a.ira > 0.5) segs.push({ key: "ira", label: "IRA", value: a.ira, color: t.series.ira });
  if (a.taxable > 0.5) segs.push({ key: "taxable", label: "Brokerage", value: a.taxable, color: t.series.taxable });
  if (a.ef > 0.5) segs.push({ key: "ef", label: "Emergency fund", value: a.ef, color: t.series.ef });
  if (a.debt > 0.5) segs.push({ key: "debt", label: "Extra debt payments", value: a.debt, color: t.series.debt });
  if (a.hsa > 0.5) segs.push({ key: "hsa", label: "HSA", value: hsaTakeHome(m, mt, hsaPayroll), color: t.series.hsa });
  if (a.goals > 0.5) segs.push({ key: "goals", label: "Savings goals", value: a.goals, color: t.series.goals });
  if (a.leftover > 0.5) segs.push({ key: "left", label: "Not assigned yet", value: a.leftover, color: t.surface2 });
  return segs;
}

/** Forecast → This month: where this month's take-home goes, and what to do with it. */
export function ThisMonth() {
  const t = useTheme();
  const { state, result, start, forecast } = usePlan();
  const [tip, setTip] = useState(false);
  const m = forecast.months[0];
  if (!m) return null;
  const rothShare = result.d.rothShare;
  const segs = splits(m, t, state.plan.marginalTax, rothShare, state.plan.hsaPayroll);
  const sum = segs.reduce((a, x) => a + x.value, 0) || 1;
  const todos = monthTodos(m, t, state.plan.marginalTax, rothShare, state.plan.hsaPayroll, spouseIraLabel(state).replace(/^Your/, "your"));
  const checks = state.incomes
    .map((inc, i) => {
      const c = m.checks[i] ?? 0;
      return c ? `${Number.isInteger(c) ? c : c.toFixed(2)} from ${inc.name || "income"}` : "";
    })
    .filter(Boolean)
    .join(", ");
  const info = `Take-home this month: ${checks ? `paychecks: ${checks}` : "no paychecks"}${m.extraCheck ? " (an extra paycheck month)" : ""}. After this month you'd have ${money(m.cash)} in cash and ${money(m.debtTotal)} of debt. Only what you've set is counted: paychecks, your employer's match, debt payments, and what you assign in Budget.`;
  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.between}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <SectionLabel>{monthLabel(start, m.m, true)} take-home</SectionLabel>
            <InfoTip text={info} label="This month's take-home" open={tip} onToggle={setTip} />
          </View>
          <Text style={[type.display, { color: t.text, fontSize: 30, lineHeight: 36, fontVariant: ["tabular-nums"] }]}>{money(m.income)}</Text>
        </View>
        {m.extraCheck ? <Pill tone="good">▲ Extra paycheck</Pill> : null}
      </View>
      {tip ? <InfoText text={info} /> : null}

      {/* the split, as one bar with 2px gaps */}
      <View style={styles.hbar} role="img" aria-label="How this month's take-home is split">
        {segs.map((x) => (
          <View key={x.key} style={{ flex: x.value / sum, backgroundColor: x.color, borderRadius: 3 }} />
        ))}
      </View>
      <View style={{ gap: 6 }}>
        {segs.map((x) => (
          <View key={x.key} style={styles.segRow}>
            <View style={[styles.sw, { backgroundColor: x.color, borderColor: t.border, borderWidth: x.key === "left" || x.key === "spend" ? 1 : 0 }]} />
            <Text style={[type.body, { color: t.text2, flex: 1, minWidth: 0 }]} numberOfLines={1}>{x.label}</Text>
            <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(x.value)}</Text>
          </View>
        ))}
      </View>

      <Divider />
      <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>{todos.length ? "To do" : "Nothing extra to do"}</Text>
      {todos.map((td) => (
        <View key={td.key} style={styles.todo}>
          <View style={[styles.dot, { backgroundColor: td.color }]} />
          <Text style={[type.body, { color: t.text2, flex: 1, minWidth: 0 }]} numberOfLines={2}>{td.title}</Text>
          {td.amount ? <Text style={[type.body, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{money(td.amount)}</Text> : null}
        </View>
      ))}
      {m.shortfall > 0.5 ? <Text style={[type.caption, { color: t.bad }]}>{shortfallText(m)}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  hbar: { flexDirection: "row", height: 22, gap: 2, borderRadius: 6, overflow: "hidden" },
  segRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sw: { width: 12, height: 12, borderRadius: 3 },
  todo: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
