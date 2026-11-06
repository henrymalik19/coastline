import { BUCKET_LABELS, BUCKETS, type MonthRow, type PlanState } from "@coastfi/engine";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/form";
import { Legend, StackedBars, type BarDatum } from "../../components/StackedBars";
import { Card, Divider, Pill, Screen, SectionLabel } from "../../components/ui";
import { bucketValues, total } from "../../lib/chart";
import { money, monthLabel } from "../../lib/format";
import { useLayout } from "../../lib/layout";
import { monthTodos, usePlan } from "../../lib/plan";
import { radius, space, type, useTheme, type Theme } from "../../lib/theme";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Seg = { key: string; label: string; value: number; color: string };

/** Where a month's take-home goes (pre-tax payroll is already out of take-home). */
function splits(m: MonthRow, t: Theme, mt: number): Seg[] {
  const a = m.alloc;
  const segs: Seg[] = [{ key: "spend", label: "Budget + debt minimums", value: m.expenses, color: t.track }];
  const matchTH = a.k401TakeHome - a.k401Step;
  if (matchTH > 0.5) segs.push({ key: "match", label: `401(k) raise to full match (+${money(a.matchGain)} match)`, value: matchTH, color: t.series.k401 });
  if (a.k401Step > 0.5) segs.push({ key: "k401", label: `Extra 401(k) (${money(a.k401Step / (1 - mt))} pre-tax)`, value: a.k401Step, color: t.series.k401 });
  if (a.ira > 0.5) segs.push({ key: "ira", label: "IRA", value: a.ira, color: t.series.ira });
  if (a.taxable > 0.5) segs.push({ key: "taxable", label: "Brokerage", value: a.taxable, color: t.series.taxable });
  if (a.ef > 0.5) segs.push({ key: "ef", label: "Emergency fund", value: a.ef, color: t.series.ef });
  if (a.debt > 0.5) segs.push({ key: "debt", label: "Extra debt payments", value: a.debt, color: t.series.debt });
  if (a.hsa > 0.5) segs.push({ key: "hsa", label: "HSA", value: a.hsa, color: t.series.hsa });
  if (a.goals > 0.5) segs.push({ key: "goals", label: "Savings goals", value: a.goals, color: t.series.goals });
  if (a.leftover > 0.5) segs.push({ key: "left", label: "Unassigned, stays in cash", value: a.leftover, color: t.surface2 });
  return segs;
}

function MonthCard({ m, title, start, state }: { m: MonthRow; title: string; start: Date; state: PlanState }) {
  const t = useTheme();
  const segs = splits(m, t, state.plan.marginalTax);
  const sum = segs.reduce((a, s) => a + s.value, 0) || 1;
  const todos = monthTodos(m, t, state.plan.marginalTax);
  const checks = state.incomes
    .map((inc, i) => {
      const c = m.checks[i] ?? 0;
      return `${Number.isInteger(c) ? c : c.toFixed(2)} from ${inc.name}`;
    })
    .join(" · ");
  return (
    <Card style={{ flex: 1, gap: space.md }}>
      <View style={styles.between}>
        <View>
          <SectionLabel>{title}</SectionLabel>
          <Text style={[type.heading, { color: t.text, marginTop: -4 }]}>{monthLabel(start, m.m, true)}</Text>
        </View>
        {m.extraCheck ? <Pill tone="good">▲ Extra paycheck</Pill> : null}
      </View>
      <View>
        <Text style={[type.display, { color: t.text, fontSize: 30, lineHeight: 36, fontVariant: ["tabular-nums"] }]}>{money(m.income)}</Text>
        <Text style={[type.caption, { color: t.text3 }]}>Take-home · paychecks: {checks || "none"}</Text>
      </View>

      {/* the split, as one bar with 2px gaps */}
      <View style={styles.hbar} role="img" aria-label="How this month's take-home is split">
        {segs.map((s) => (
          <View key={s.key} style={{ flex: s.value / sum, backgroundColor: s.color, borderRadius: 3 }} />
        ))}
      </View>
      <View style={{ gap: 6 }}>
        {segs.map((s) => (
          <View key={s.key} style={styles.segRow}>
            <View style={[styles.sw, { backgroundColor: s.color, borderColor: t.border, borderWidth: s.key === "left" || s.key === "spend" ? 1 : 0 }]} />
            <Text style={[type.body, { color: t.text2, flex: 1 }]}>{s.label}</Text>
            <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(s.value)}</Text>
          </View>
        ))}
      </View>

      <Divider />
      <Text style={[type.label, { color: t.text }]}>To do</Text>
      {todos.length ? (
        todos.map((td) => (
          <View key={td.key} style={styles.todo}>
            <View style={[styles.dot, { backgroundColor: td.color }]} />
            <Text style={[type.body, { color: t.text2, flex: 1 }]}>{td.title}</Text>
            {td.amount ? <Text style={[type.body, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{money(td.amount)}</Text> : null}
          </View>
        ))
      ) : (
        <Text style={[type.caption, { color: t.text3 }]}>Nothing extra this month.</Text>
      )}
      {m.shortfall > 0.5 ? <Text style={[type.caption, { color: t.bad }]}>Short {money(m.shortfall)}, covered from cash.</Text> : null}
      <Text style={[type.caption, { color: t.text3 }]}>
        After this month: cash {money(m.cash)} · debt {money(m.debtTotal)}
      </Text>
    </Card>
  );
}

export default function Monthly() {
  const t = useTheme();
  const { twoColumn } = useLayout();
  const { state, result: o, start, isSample } = usePlan();
  const [selected, setSelected] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const months = o.plan.months.slice(0, 36);
  const data: BarDatum[] = months.map((m, i) => ({
    key: String(m.m),
    label: m.mo % 3 === 0 || i === 0 ? MON[m.mo]! : "",
    sub: m.mo === 0 || i === 0 ? String(m.y) : undefined,
    full: monthLabel(start, m.m, true),
    values: bucketValues(m),
    marker: m.extraCheck,
  }));
  const legend = BUCKETS.filter((k) => data.some((d) => d.values[k] > 0.5)).map((k) => ({ key: k, label: BUCKET_LABELS[k], color: t.series[k] }));
  const sel = selected !== null ? data[selected] : null;

  return (
    <Screen title="Monthly" subtitle="Your money, month by month" right={isSample ? <Pill tone="accent">Sample plan</Pill> : undefined}>
      <View style={{ flexDirection: twoColumn ? "row" : "column", gap: space.lg, alignItems: "stretch" }}>
        {months[0] ? <MonthCard m={months[0]} title="This month" start={start} state={state} /> : null}
        {months[1] ? <MonthCard m={months[1]} title="Next month" start={start} state={state} /> : null}
      </View>

      <Card style={{ gap: space.md }}>
        <View style={styles.between}>
          <View style={{ flex: 1 }}>
            <SectionLabel>Saved & invested each month</SectionLabel>
            <Text style={[type.heading, { color: t.text, marginTop: -4 }]}>Next 3 years</Text>
          </View>
          <Button title={showTable ? "Show chart" : "Show table"} onPress={() => setShowTable((v) => !v)} />
        </View>
        <Legend items={legend} />

        {showTable ? (
          <ScrollView horizontal>
            <View>
              <View style={[styles.tr, { borderBottomColor: t.border }]}>
                <Text style={[styles.th, styles.c0, { color: t.text3 }]}>Month</Text>
                {BUCKETS.map((k) => (
                  <Text key={k} style={[styles.th, styles.cn, { color: t.text3 }]}>{BUCKET_LABELS[k]}</Text>
                ))}
                <Text style={[styles.th, styles.cn, { color: t.text3 }]}>Total</Text>
                <Text style={[styles.th, styles.cn, { color: t.text3 }]}>Cash after</Text>
                <Text style={[styles.th, styles.cn, { color: t.text3 }]}>Debt after</Text>
              </View>
              {months.map((m, i) => (
                <View key={m.m} style={[styles.tr, { borderBottomColor: t.border }]}>
                  <Text style={[styles.td, styles.c0, { color: t.text }]}>{data[i]!.full}{m.extraCheck ? " ▲" : ""}</Text>
                  {BUCKETS.map((k) => (
                    <Text key={k} style={[styles.td, styles.cn, { color: t.text2 }]}>{data[i]!.values[k] > 0.5 ? money(data[i]!.values[k]) : "–"}</Text>
                  ))}
                  <Text style={[styles.td, styles.cn, { color: t.text, fontWeight: "600" }]}>{money(total(data[i]!.values))}</Text>
                  <Text style={[styles.td, styles.cn, { color: t.text2 }]}>{money(m.cash)}</Text>
                  <Text style={[styles.td, styles.cn, { color: t.text2 }]}>{money(m.debtTotal)}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : (
          <>
            <StackedBars
              data={data}
              colors={t.series}
              height={twoColumn ? 320 : 260}
              selected={selected}
              onSelect={setSelected}
              label="Monthly savings and investments by destination for the next 36 months. Use the table view for exact values."
            />
            {/* details for the hovered / tapped month (a panel, so it works on touch too) */}
            <View style={[styles.detail, { backgroundColor: t.surface2 }]} role="status">
              {sel ? (
                <>
                  <View style={styles.between}>
                    <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>
                      {sel.full}
                      {sel.marker ? "  ▲ extra paycheck" : ""}
                    </Text>
                    <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(total(sel.values))}</Text>
                  </View>
                  <View style={styles.detailGrid}>
                    {BUCKETS.filter((k) => sel.values[k] > 0.5).map((k) => (
                      <View key={k} style={styles.detailItem}>
                        <View style={[styles.sw, { backgroundColor: t.series[k] }]} />
                        <Text style={[type.caption, { color: t.text2 }]}>{BUCKET_LABELS[k]}</Text>
                        <Text style={[type.caption, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{money(sel.values[k])}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={[type.caption, { color: t.text3 }]}>Hover or tap a month to see where its money goes.</Text>
              )}
            </View>
          </>
        )}
        <Text style={[type.caption, { color: t.text3 }]}>▲ marks a 3-paycheck (or 5-paycheck) month. 401(k) includes payroll contributions and the employer match.</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  hbar: { flexDirection: "row", height: 22, gap: 2, borderRadius: 6, overflow: "hidden" },
  segRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sw: { width: 12, height: 12, borderRadius: 3 },
  todo: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  detail: { borderRadius: radius.md, padding: space.md, gap: space.sm, minHeight: 48, justifyContent: "center" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  detailItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  tr: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  th: { ...type.overline, paddingVertical: 8, paddingHorizontal: 6 },
  td: { ...type.caption, paddingVertical: 8, paddingHorizontal: 6, fontVariant: ["tabular-nums"] },
  c0: { width: 150 },
  cn: { width: 110, textAlign: "right" },
});
