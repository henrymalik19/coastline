/** Forecast → What if: try saving more, other returns, other spending, another retirement age, and one-off changes. Nothing here changes what to really do this month. */
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AdjustmentsCard } from "./AdjustmentsCard";
import { Button, InfoText, InfoTip } from "./form";
import { ProjectionChart } from "./ProjectionChart";
import { Slider } from "./Slider";
import { Legend } from "./StackedBars";
import { Card, Pill, SectionLabel } from "./ui";
import { money, percent } from "../lib/format";
import { useLayout } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";

const SLIDERS_INFO = "Try a change and see your dates and odds move. Extra savings go through your priority order. These are only what-ifs: your to-dos stay on your real plan, and while they're on, Home, Overview and the Table show what they change in orange. Retire at is different: it changes your actual retirement age.";

export function WhatIf() {
  const t = useTheme();
  const { twoColumn } = useLayout();
  const { state, result: o, start, whatIfOn } = usePlan();
  const update = useStore((s) => s.update);
  const [tip, setTip] = useState(false);
  const w = state.whatif;
  const d = o.d;
  const slidersOn = !!(w.extra || w.retDelta || w.spendDelta);

  const sliders = (
    <Card style={{ gap: space.md }}>
      <View style={styles.between}>
        <View style={[styles.row, { flexShrink: 1 }]}>
          <SectionLabel flush>What if…</SectionLabel>
          <InfoTip text={SLIDERS_INFO} label="What if" open={tip} onToggle={setTip} />
        </View>
        {whatIfOn ? <Pill tone="warn">What-ifs are on</Pill> : null}
      </View>
      {tip ? <InfoText text={SLIDERS_INFO} /> : null}
      <View style={[styles.sliders, { flexDirection: twoColumn ? "row" : "column" }]}>
        <SliderRow label="Extra saved a month" value={`+${money(w.extra, { whole: true })}`}>
          <Slider label="Extra saved per month" valueText={money(w.extra)} value={w.extra} min={0} max={2000} step={50} onChange={(v) => update((p) => { p.whatif.extra = v; })} />
        </SliderRow>
        <SliderRow label="Returns vs. assumed" value={`${w.retDelta >= 0 ? "+" : "−"}${Math.abs(w.retDelta * 100).toFixed(2).replace(/\.?0+$/, "")} pts`}>
          <Slider label="Returns versus assumption" valueText={`${(w.retDelta * 100).toFixed(2)} points`} value={w.retDelta * 100} min={-3} max={2} step={0.25} onChange={(v) => update((p) => { p.whatif.retDelta = v / 100; })} />
        </SliderRow>
        <SliderRow label="Retirement spending" value={`${w.spendDelta >= 0 ? "+" : "−"}${Math.abs(Math.round(w.spendDelta * 100))}%`}>
          <Slider label="Retirement spending change" valueText={`${Math.round(w.spendDelta * 100)} percent`} value={w.spendDelta * 100} min={-40} max={40} step={5} onChange={(v) => update((p) => { p.whatif.spendDelta = v / 100; })} />
        </SliderRow>
        <SliderRow label="Retire at" value={String(state.retireAge)}>
          <Slider label="Retirement age" valueText={`age ${state.retireAge}`} value={state.retireAge} min={Math.max(state.age + 1, 35)} max={75} step={1} onChange={(v) => update((p) => { p.retireAge = v; })} />
        </SliderRow>
      </View>
      <Button title="Reset sliders" disabled={!slidersOn} onPress={() => update((p) => { p.whatif = { extra: 0, retDelta: 0, spendDelta: 0 }; })} style={{ alignSelf: "flex-start" }} />
    </Card>
  );

  return (
    <View style={{ gap: space.lg }}>
      {sliders}
      <AdjustmentsCard start={start} />
      <Odds />
      <Text style={[type.caption, { color: t.text3 }]}>
        {percent(d.r, 2)} real return after fees, {percent(d.vol)} volatility.
      </Text>
    </View>
  );
}

/** The range of outcomes (2,000 simulated markets) with the what-ifs applied. */
function Odds() {
  const t = useTheme();
  const { twoColumn } = useLayout();
  const { result: o } = usePlan();
  const [sel, setSel] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [tip, setTip] = useState(false);
  const d = o.d;
  const b = sel !== null ? o.mc.bands[sel] : null;
  // the range at your retirement age, in words (the chart below draws every age)
  const atRetire = o.mc.bands[Math.min(o.mc.bands.length - 1, Math.max(0, Math.round(d.years)))];
  // no retirement spending yet: there are no odds to show (everything would read 100% against $0)
  if (o.fire <= 0)
    return (
      <Card style={{ gap: space.sm }}>
        <SectionLabel flush>Range of outcomes</SectionLabel>
        <Text style={[type.body, { color: t.text2 }]}>
          Add your budget, or a yearly amount in Money → What you'll spend, to see how likely you are to reach your number.
        </Text>
      </Card>
    );
  const info = `Markets don't grow in a straight line. This runs 2,000 possible futures with ups and downs and shows the middle of them (the line) and the spread: the darker band is the middle half of outcomes, the lighter one 80%. Not a guarantee.`;
  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.between}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.row}>
            <SectionLabel flush>Range of outcomes</SectionLabel>
            <InfoTip text={info} label="Range of outcomes" open={tip} onToggle={setTip} />
          </View>
          <Text style={[type.heading, { color: t.text, marginTop: -4 }]}>{percent(o.mc.probFire)} odds of FIRE by {d.retireAge}</Text>
        </View>
        <Button title={table ? "Chart" : "Table"} onPress={() => setTable((v) => !v)} />
      </View>
      {tip ? <InfoText text={info} /> : null}
      {atRetire ? (
        <Text style={[type.body, { color: t.text2 }]}>
          At {d.retireAge}, you'd most likely have about <Text style={{ color: t.text, fontWeight: "700" }}>{money(atRetire.p50, { whole: true })}</Text>. In 8 out of 10
          futures, between {money(atRetire.p10, { whole: true })} and {money(atRetire.p90, { whole: true })}
          {o.fire > 0 ? `, against the ${money(o.fire, { whole: true })} you need` : ""}.
        </Text>
      ) : null}
      <Legend
        items={[
          { key: "m", label: "Median", color: t.series.k401 },
          { key: "b", label: "Middle 50% / 80%", color: t.accentSoft },
          { key: "c", label: "Coast FI number", color: t.series.ira },
          { key: "f", label: "FIRE number (dashed)", color: t.text3 },
        ]}
      />
      {table ? (
        <ScrollView style={{ maxHeight: 360 }}>
          <View style={[styles.tr, { borderBottomColor: t.border }]}>
            {["Age", "10th pct", "Median", "90th pct"].map((h, i) => (
              <Text key={h} style={[styles.th, i ? styles.cn : styles.c0, { color: t.text3 }]}>{h}</Text>
            ))}
          </View>
          {o.mc.bands.map((bd, i) => (
            <View key={i} style={[styles.tr, { borderBottomColor: t.border }]}>
              <Text style={[styles.td, styles.c0, { color: t.text }]}>{d.age + i}</Text>
              {[bd.p10, bd.p50, bd.p90].map((v, j) => (
                <Text key={j} style={[styles.td, styles.cn, { color: j === 1 ? t.text : t.text2, fontWeight: j === 1 ? "600" : "400" }]}>{money(v, { whole: true })}</Text>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : (
        <>
          <ProjectionChart bands={o.mc.bands} coastCurve={o.coastCurve} fire={o.fire} age={d.age} crossing={o.crossing} height={twoColumn ? 320 : 240} selected={sel} onSelect={setSel} />
          <View style={[styles.detail, { backgroundColor: t.surface2 }]} role="status">
            {b && sel !== null ? (
              <View style={styles.detailGrid}>
                <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Age {d.age + sel}</Text>
                <Text style={[type.caption, { color: t.text2 }]}>Median <Text style={{ color: t.text, fontWeight: "700" }}>{money(b.p50, { whole: true })}</Text></Text>
                <Text style={[type.caption, { color: t.text2 }]}>80% range <Text style={{ color: t.text, fontWeight: "600" }}>{money(b.p10, { whole: true })}–{money(b.p90, { whole: true })}</Text></Text>
              </View>
            ) : (
              <Text style={[type.caption, { color: t.text3 }]}>Tap the chart to see a year's range.</Text>
            )}
          </View>
        </>
      )}
    </Card>
  );
}

function SliderRow({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
      <View style={styles.between}>
        <Text style={[type.label, { color: t.text2 }]} numberOfLines={1}>{label}</Text>
        <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{value}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  sliders: { gap: space.xl },
  detail: { borderRadius: radius.md, padding: space.md, minHeight: 44, justifyContent: "center" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: space.lg, rowGap: 4, alignItems: "center" },
  tr: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  th: { ...type.overline, paddingVertical: 8, paddingHorizontal: 6 },
  td: { ...type.caption, paddingVertical: 8, paddingHorizontal: 6, fontVariant: ["tabular-nums"] },
  c0: { flex: 0.6 },
  cn: { flex: 1, textAlign: "right" },
});
