/**
 * Forecast → What if: try a change and see it next to your plan. Invest more, other returns, other
 * retirement spending, another retirement age, more on a mortgage, and one-off months. Nothing here
 * changes your plan (or this month's to-dos) until you make it yours.
 * - "Trying": what's on, in words.
 * - The chart: your plan (teal) and the what-if (orange), with the range of market outcomes if you want it.
 * - Your accounts when you retire, on your plan and on the what-if.
 */
import { accountForecasts, BUCKET_LABELS, finalAndFire, mortgagePayoffs, mortgagesAtRetirement, run, type AccountKey, type PlanState } from "@coastfi/engine";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AdjustmentsCard } from "./AdjustmentsCard";
import { CompareChart } from "./CompareChart";
import { Button, InfoText, InfoTip, InlineSwitch } from "./form";
import { Slider } from "./Slider";
import { Card, Divider, SectionLabel } from "./ui";
import { confirm } from "../lib/confirm";
import { debtLabel } from "../lib/debts";
import { money, percent } from "../lib/format";
import { useLayout } from "../lib/layout";
import { hasWhatIf, NO_WHATIF, usePlan, withoutWhatIfs } from "../lib/plan";
import { spouseIraLabel } from "../lib/spouse";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";

const INVESTED: AccountKey[] = ["k401", "ira", "iraSpouse", "hsa", "taxable", "other"];
const SLIDERS_INFO = "Try a change and see it next to your plan. More saved goes through your priority order. Nothing here changes your plan or this month's to-dos; while a what-if is on, Home shows what it changes in orange.";

export function WhatIf() {
  const t = useTheme();
  const { twoColumn } = useLayout();
  const { state, result: o, start, whatIfOn, actual, realD } = usePlan();
  const update = useStore((s) => s.update);
  const [tip, setTip] = useState(false);
  const [range, setRange] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const w = state.whatif;
  const d = o.d;
  const real = useMemo(() => withoutWhatIfs(state), [state]);
  // your plan, without the what-ifs: its path and FIRE number (the what-if's are in `o`)
  const planLine = useMemo(() => (whatIfOn ? finalAndFire(real, start) : null), [whatIfOn, real, start]);
  const planFinal = planLine ? planLine.final : o.projectedFinal;
  const planFire = planLine ? planLine.fire : o.fire;
  // the odds on your plan, only when asked (another 2,000 simulated markets)
  const planOdds = useMemo(() => (range && whatIfOn ? run(real, start).mc.probFire : null), [range, whatIfOn, real, start]);
  // mortgages still being paid, and what pays each off by the time you retire (on your plan)
  const mortgages = state.debts.filter((x) => x.kind === "mortgage" && !x.payroll && x.balance > 0);
  const payoffs = useMemo(() => mortgagePayoffs(real, { d: realD, mortgagesAtRetire: mortgagesAtRetirement(real, realD, actual) }), [real, realD, actual]);
  const spendPlan = realD.retireMonthly;
  const retireAge = w.retireAge ?? state.retireAge;

  const setW = (fn: (x: PlanState["whatif"]) => void) => update((p) => { fn(p.whatif); });
  const reset = async () => {
    const months = (state.adjustments ?? []).length;
    if (months && !(await confirm("Reset all what-ifs?", `This puts the sliders back and removes ${months === 1 ? "the one-month what-if" : `${months} one-month what-ifs`}.`, "Reset"))) return;
    update((p) => {
      p.whatif = { ...NO_WHATIF };
      p.adjustments = [];
    });
  };

  // what's on, in words
  const trying = [
    w.extra > 0 ? `invest ${money(w.extra, { whole: true })}/mo more` : "",
    w.retireAge !== undefined ? `retire at ${w.retireAge}` : "",
    w.spendDelta ? `spend ${money(spendPlan * (1 + w.spendDelta), { whole: true })}/mo` : "",
    w.retDelta ? `${percent(state.ret + w.retDelta, 2)} returns` : "",
    ...mortgages.filter((x) => (w.loanExtra?.[x.id] ?? 0) > 0).map((x) => `${money(w.loanExtra![x.id]!, { whole: true })}/mo more on ${debtLabel(x)}`),
    (state.adjustments ?? []).length ? `${state.adjustments!.length} one-month change${state.adjustments!.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  // each account when you retire: on your plan and on the what-if
  const at = (s: PlanState, dd: typeof d, plan: typeof o.plan) => {
    const idx = Math.max(0, dd.years * 12 - 1);
    const out = new Map<AccountKey, number>();
    for (const f of accountForecasts(s, dd, plan, dd.r)) if (INVESTED.includes(f.key)) out.set(f.key, f.months[Math.min(idx, f.months.length - 1)]?.balance ?? f.start);
    return out;
  };
  const accounts = useMemo(() => {
    const mine = at(real, realD, actual);
    const theirs = whatIfOn ? at(state, d, o.plan) : mine;
    return INVESTED.filter((k) => (mine.get(k) ?? 0) > 0.5 || (theirs.get(k) ?? 0) > 0.5).map((k) => ({ k, plan: mine.get(k) ?? 0, what: theirs.get(k) ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, realD, actual, state, d, o.plan, whatIfOn]);
  const label = (k: AccountKey) => (k === "iraSpouse" ? spouseIraLabel(state) : BUCKET_LABELS[k as keyof typeof BUCKET_LABELS] ?? k);

  const onTrack = o.projectedFinal + 0.5 >= o.fire;
  const planOnTrack = planFinal + 0.5 >= planFire;

  return (
    <View style={{ gap: space.lg }}>
      {whatIfOn ? (
        <Card style={{ gap: space.xs, borderColor: t.warn, borderWidth: 2 }}>
          <View style={styles.between}>
            <Text style={[type.body, { color: t.text, flex: 1 }]}>
              <Text style={{ color: t.warn, fontWeight: "800" }}>Trying: </Text>
              {trying.join(", ")}
            </Text>
            <Text role="button" onPress={() => void reset()} style={[type.label, { color: t.warn, fontWeight: "700" }]}>Reset</Text>
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>Nothing here changes your plan until you make it yours.</Text>
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <View style={[styles.row, { flexShrink: 1 }]}>
          <SectionLabel flush>What if…</SectionLabel>
          <InfoTip text={SLIDERS_INFO} label="What if" open={tip} onToggle={setTip} />
        </View>
        {tip ? <InfoText text={SLIDERS_INFO} /> : null}
        <View style={[styles.sliders, { flexDirection: twoColumn ? "row" : "column", flexWrap: "wrap" }]}>
          <SliderRow label="Invest more each month" value={`+${money(w.extra, { whole: true })}`} on={w.extra > 0}>
            <Slider label="Invest more each month" valueText={money(w.extra)} value={w.extra} min={0} max={3000} step={25} onChange={(v) => setW((x) => { x.extra = v; })} />
          </SliderRow>
          <SliderRow label={`Retire at (yours: ${state.retireAge})`} value={String(retireAge)} on={w.retireAge !== undefined}>
            <Slider
              label="Retire at, to try"
              valueText={`age ${retireAge}, yours is ${state.retireAge}`}
              value={retireAge}
              min={Math.max(state.age + 1, 35)}
              max={75}
              step={1}
              onChange={(v) => setW((x) => { if (v === state.retireAge) delete x.retireAge; else x.retireAge = v; })}
            />
          </SliderRow>
          <SliderRow label="Spend in retirement" value={`${money(spendPlan * (1 + w.spendDelta), { whole: true })}/mo`} on={!!w.spendDelta}>
            <Slider label="Retirement spending change" valueText={`${Math.round(w.spendDelta * 100)} percent`} value={w.spendDelta * 100} min={-40} max={40} step={1} onChange={(v) => setW((x) => { x.spendDelta = v / 100; })} />
          </SliderRow>
          <SliderRow label={`Yearly return (yours: ${percent(state.ret, 1)})`} value={percent(state.ret + w.retDelta, 2).replace(/0+%$/, "%").replace(/\.%$/, "%")} on={!!w.retDelta}>
            <Slider label="Yearly return to try" valueText={`${percent(state.ret + w.retDelta, 2)} a year, your setting is ${percent(state.ret, 1)}`} value={w.retDelta * 100} min={-3} max={2} step={0.25} onChange={(v) => setW((x) => { x.retDelta = v / 100; })} />
          </SliderRow>
        </View>
        {mortgages.length ? (
          <>
            <Divider />
            <SectionLabel flush>Extra on your mortgages</SectionLabel>
            {mortgages.map((x) => {
              const pay = payoffs.find((p) => p.id === x.id);
              const more = w.loanExtra?.[x.id] ?? 0;
              const max = Math.max(1000, Math.ceil(((pay?.extra ?? 0) * 1.5) / 50) * 50);
              return (
                <SliderRow
                  key={x.id}
                  label={debtLabel(x)}
                  sub={pay ? `Runs past ${realD.retireAge} · ${money(pay.extra, { whole: true })}/mo more pays it off by then` : `Paid off before you retire`}
                  value={`+${money(more, { whole: true })}`}
                  on={more > 0}
                >
                  <Slider
                    label={`More a month on ${debtLabel(x)}`}
                    valueText={money(more)}
                    value={more}
                    min={0}
                    max={max}
                    step={25}
                    onChange={(v) => setW((y) => { const le = { ...(y.loanExtra ?? {}) }; if (v > 0) le[x.id] = v; else delete le[x.id]; if (Object.keys(le).length) y.loanExtra = le; else delete y.loanExtra; })}
                  />
                </SliderRow>
              );
            })}
          </>
        ) : null}
        <Divider />
        <AdjustmentsCard start={start} embedded />
      </Card>

      <Card style={{ gap: space.md }}>
        {o.fire > 0 ? (
          <View style={[styles.verdict, { backgroundColor: onTrack ? t.goodSoft : t.warnSoft }]}>
            <Text style={[type.label, { color: t.text, fontWeight: "800" }]}>
              {onTrack ? "On track ✓" : `${money(o.fire - o.projectedFinal, { whole: true })} short at ${d.retireAge}`}
            </Text>
            <Text style={[type.caption, { color: t.text2 }]}>
              {whatIfOn ? "With the what-if: " : ""}about {money(o.projectedFinal, { whole: true })} invested at {d.retireAge}, for a FIRE number of {money(o.fire, { whole: true })}.
              {whatIfOn ? ` Your plan: ${money(planFinal, { whole: true })} at ${realD.retireAge} for ${money(planFire, { whole: true })} (${planOnTrack ? "on track" : "short"}).` : ""}
            </Text>
          </View>
        ) : null}
        <SectionLabel flush>{whatIfOn ? "Your plan vs what if" : "Your plan"}</SectionLabel>
        <View style={styles.stats}>
          <View style={[styles.stat, { backgroundColor: t.surface2 }]}>
            <Text style={[type.caption, { color: t.text3 }]}>At {realD.retireAge}, your plan</Text>
            <Text style={[type.label, { color: t.text, fontWeight: "800", fontVariant: ["tabular-nums"] }]}>{money(planFinal, { whole: true })}</Text>
          </View>
          {whatIfOn ? (
            <View style={[styles.stat, { backgroundColor: t.surface2 }]}>
              <Text style={[type.caption, { color: t.text3 }]}>At {d.retireAge}, what if</Text>
              <Text style={[type.label, { color: t.warn, fontWeight: "800", fontVariant: ["tabular-nums"] }]}>{money(o.projectedFinal, { whole: true })}</Text>
            </View>
          ) : null}
        </View>
        <CompareChart
          age={d.age}
          plan={{ series: planLine ? planLine.series : o.projSeries, months: realD.years * 12, fire: planFire }}
          what={whatIfOn ? { series: o.projSeries, months: d.years * 12, fire: o.fire } : undefined}
          bands={range ? o.mc.bands : undefined}
          height={twoColumn ? 320 : 240}
          selected={sel}
          onSelect={setSel}
        />
        <View style={styles.legend}>
          <Key color={t.series.k401} text="Your plan" />
          {whatIfOn ? <Key color={t.warn} text="What if" /> : null}
          <Key color={t.good} text="FIRE number" dashed />
        </View>
        <View style={[styles.detail, { backgroundColor: t.surface2 }]} role="status">
          <Text style={[type.caption, { color: sel !== null ? t.text2 : t.text3 }]}>
            {sel !== null ? `Age ${d.age + sel}: your plan ${money(Number((planLine ? planLine.series : o.projSeries)[Math.min(sel * 12, realD.years * 12)] ?? 0), { whole: true })}${whatIfOn ? `, what if ${money(Number(o.projSeries[Math.min(sel * 12, d.years * 12)] ?? 0), { whole: true })}` : ""}` : "Tap the chart to see a year."}
          </Text>
        </View>
        <View style={styles.between}>
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Show market range</Text>
            <Text style={[type.caption, { color: t.text3 }]}>
              {range
                ? `Shaded: where you could land in good and bad markets (half land in the darker band, 8 in 10 in the lighter one). Odds of reaching your FIRE number by ${d.retireAge}: ${whatIfOn ? `what if ${percent(o.mc.probFire)}, your plan ${planOdds !== null ? percent(planOdds) : "…"}` : percent(o.mc.probFire)}.`
                : "The lines assume average returns every year."}
            </Text>
          </View>
          <InlineSwitch label="Show market range" value={range} onChange={setRange} />
        </View>
      </Card>

      {accounts.length ? (
        <Card style={{ gap: 2 }}>
          <SectionLabel flush>Your accounts when you retire</SectionLabel>
          <View style={[styles.tr, { borderBottomColor: t.border }]}>
            <Text style={[styles.th, styles.c0, { color: t.text3 }]}>Account</Text>
            <Text style={[styles.th, styles.cn, { color: t.text3 }]}>Plan, {realD.retireAge}</Text>
            {whatIfOn ? <Text style={[styles.th, styles.cn, { color: t.text3 }]}>What if, {d.retireAge}</Text> : null}
          </View>
          {[...accounts, { k: "total" as const, plan: accounts.reduce((a, x) => a + x.plan, 0), what: accounts.reduce((a, x) => a + x.what, 0) }].map((r) => (
            <View key={r.k} style={[styles.tr, { borderBottomColor: t.border }]}>
              <Text style={[styles.td, styles.c0, { color: t.text, fontWeight: r.k === "total" ? "700" : "400" }]}>{r.k === "total" ? "Total" : label(r.k)}</Text>
              <Text style={[styles.td, styles.cn, { color: t.text, fontWeight: r.k === "total" ? "700" : "400" }]}>{money(r.plan, { whole: true })}</Text>
              {whatIfOn ? <Text style={[styles.td, styles.cn, { color: t.warn, fontWeight: "700" }]}>{money(r.what, { whole: true })}</Text> : null}
            </View>
          ))}
        </Card>
      ) : null}

      {whatIfOn ? (
        <Card style={{ gap: space.sm }}>
          {w.retireAge !== undefined ? (
            <Button title={`Make ${w.retireAge} my retirement age`} tone="primary" onPress={() => update((p) => { p.retireAge = w.retireAge!; delete p.whatif.retireAge; })} style={{ alignSelf: "flex-start" }} />
          ) : null}
          <Text style={[type.caption, { color: t.text3 }]}>
            {hasWhatIf({ ...w, retireAge: undefined })
              ? "To make the rest real: invest more by lowering your budget or raising your income; change spending under Retirement spending; pay more on a mortgage from Debts and your priority order."
              : "One-month changes stay what-ifs until the month comes."}
          </Text>
          <Button title="Reset all what-ifs" onPress={() => void reset()} style={{ alignSelf: "flex-start" }} />
        </Card>
      ) : null}
      <Text style={[type.caption, { color: t.text3 }]}>
        {percent(d.r, 2)} real return after fees, {percent(d.vol)} volatility.
      </Text>
    </View>
  );
}

function Key({ color, text, dashed }: { color: string; text: string; dashed?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: color, opacity: dashed ? 0.8 : 1 }} />
      <Text style={[type.caption, { color: t.text2 }]}>{text}</Text>
    </View>
  );
}

function SliderRow({ label, sub, value, on, children }: { label: string; sub?: string; value: string; on?: boolean; children: React.ReactNode }) {
  const t = useTheme();
  return (
    // side by side on a wide screen (each at least 260 wide); stacked on a phone
    <View style={[{ gap: 2, minWidth: 0 }, useLayout().twoColumn ? { flexGrow: 1, flexBasis: 260 } : null]}>
      <View style={styles.between}>
        <Text style={[type.label, { color: t.text2, flexShrink: 1 }]} numberOfLines={1}>{label}</Text>
        <Text style={[type.label, { color: on ? t.warn : t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{value}</Text>
      </View>
      {sub ? <Text style={[type.caption, { color: t.text3 }]}>{sub}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  sliders: { gap: space.xl },
  verdict: { borderRadius: radius.md, padding: space.md, gap: 4 },
  stats: { flexDirection: "row", gap: space.sm },
  stat: { flex: 1, borderRadius: radius.md, padding: space.md, gap: 2 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  detail: { borderRadius: radius.md, padding: space.md, minHeight: 44, justifyContent: "center" },
  tr: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  th: { ...type.overline, paddingVertical: 8, paddingHorizontal: 6 },
  td: { ...type.caption, paddingVertical: 8, paddingHorizontal: 6, fontVariant: ["tabular-nums"] },
  c0: { flex: 1.2 },
  cn: { flex: 1, textAlign: "right" },
});
