/** Progress → Your number: how the FIRE and Coast numbers are worked out, and the FI levels. */
import { baristaFi, FAT_FACTOR, fireBreakdown, fiLevels } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money, monthLabel, percent } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Select } from "./form";
import { Slider } from "./Slider";
import { Card, Divider, Pill, SectionLabel } from "./ui";

const SWRS = [0.03, 0.0325, 0.035, 0.0375, 0.04, 0.045];

export function NumberBreakdown() {
  const t = useTheme();
  const router = useRouter();
  const { state, result: o, start } = usePlan();
  const update = useStore((s) => s.update);
  const b = fireBreakdown(state, o);
  const levels = fiLevels(state, o);
  const barista = baristaFi(o);
  const d = o.d;

  const row = (label: string, value: string, opts: { sub?: string; strong?: boolean; indent?: boolean; tone?: string } = {}) => (
    <View style={[styles.row, opts.indent ? { paddingLeft: space.md } : null]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[opts.strong ? type.body : type.caption, { color: opts.strong ? t.text : t.text2, fontWeight: opts.strong ? "700" : "500" }]}>{label}</Text>
        {opts.sub ? <Text style={[type.caption, { color: t.text3 }]}>{opts.sub}</Text> : null}
      </View>
      <Text style={[opts.strong ? type.body : type.caption, { color: opts.tone ?? t.text, fontWeight: opts.strong ? "700" : "600", fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  );
  const step = (n: number, title: string) => (
    <View style={styles.stepHead}>
      <View style={[styles.num, { backgroundColor: t.accentSoft }]}>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{n}</Text>
      </View>
      <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>{title}</Text>
    </View>
  );
  const per = (yearly: number) => `${money(yearly, { whole: true })}/yr · ${money(yearly / 12, { whole: true })}/mo`;
  const swrOptions = SWRS.map((v) => ({ value: String(v), label: percent(v, 2).replace(/0%$/, "%").replace(/\.0%$/, "%") }));
  if (!SWRS.includes(d.swr)) swrOptions.push({ value: String(d.swr), label: percent(d.swr, 2) });

  const breakdown = (
    <Card style={{ gap: space.md }}>
      <SectionLabel>How your number is worked out</SectionLabel>

      {step(1, "What you'll spend in retirement")}
      <View style={{ gap: 2 }}>
        {b.spending.map((x) => <View key={x.key}>{row(x.label, `${x.monthly < 0 ? "−" : ""}${money(Math.abs(x.monthly), { whole: true })}/mo`, { indent: true })}</View>)}
        <Divider />
        {row("Retirement spending", per(b.retireAnnual), { strong: true })}
        <Pressable role="link" onPress={() => router.push("/money/retirement?from=number")} hitSlop={6} style={{ alignSelf: "flex-start", marginTop: 2 }}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Choose which categories you'd still pay →</Text>
        </Pressable>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={[type.caption, { color: t.text3 }]}>Change it: {d.retireMonthly > 0 ? `${state.whatif.spendDelta >= 0 ? "+" : "−"}${Math.abs(Math.round(state.whatif.spendDelta * 100))}% from your budget` : "add budget items marked “Still paid after you retire”"}</Text>
        <Slider label="Retirement spending change" valueText={`${Math.round(state.whatif.spendDelta * 100)} percent`} value={state.whatif.spendDelta * 100} min={-40} max={40} step={5} onChange={(v) => update((p) => { p.whatif.spendDelta = v / 100; })} />
      </View>

      {step(2, "What your savings has to cover")}
      <View style={{ gap: 2 }}>
        {b.income > 0.5 ? row("Social Security and pensions", `− ${per(b.income)}`, { indent: true }) : null}
        {row("From your savings", per(b.need), { strong: true })}
      </View>

      {step(3, "Your FIRE number")}
      <View style={{ gap: 2 }}>
        {row(`${money(b.need, { whole: true })} ÷ ${percent(b.swr, 2).replace(/0%$/, "%")} withdrawal rate`, money(b.base, { whole: true }), { indent: true, sub: `Taking out ${percent(b.swr, 2).replace(/0%$/, "%")} a year is meant to last for life` })}
        {b.taxExtra > 0.5 ? row("Plus income tax on pre-tax money", `+ ${money(b.taxExtra, { whole: true })}`, { indent: true, sub: `${percent(d.taxRate)} tax on the ${percent(o.preShareFinal)} that's pre-tax` }) : null}
        {b.bridge > 0.5 ? row("Plus income that starts later", `+ ${money(b.bridge, { whole: true })}`, { indent: true, sub: "Covers you until Social Security or a pension starts" }) : null}
        {b.healthBridge > 0.5 ? row("Plus health insurance until 65", `+ ${money(b.healthBridge, { whole: true })}`, { indent: true, sub: `${money(state.healthcare, { whole: true })}/mo from ${d.retireAge} until Medicare starts` }) : null}
        {b.homeBridge > 0.5 ? row("Plus mortgage still owed", `+ ${money(b.homeBridge, { whole: true })}`, { indent: true, sub: "What's left on it when you retire" }) : null}
        <Divider />
        {row("FIRE number", money(b.fire, { whole: true }), { strong: true, sub: `Invested by age ${d.retireAge}` })}
      </View>
      <View style={[styles.row, { flexWrap: "wrap" }]}>
        <Text style={[type.caption, { color: t.text3, flex: 1, minWidth: 160 }]}>Withdrawal rate: lower is safer and needs more saved.</Text>
        <Select label="Withdrawal rate" value={String(d.swr)} options={swrOptions} onChange={(v) => update((p) => { p.swr = Number(v); })} />
      </View>

      {step(4, "Your Coast number today")}
      <View style={{ gap: 2 }}>
        {row(`${money(b.fire, { whole: true })} ÷ ${b.growth.toFixed(2)}`, money(b.coastNow, { whole: true }), { indent: true, sub: `A dollar today grows ${b.growth.toFixed(2)}× in ${b.years} years at ${percent(b.r, 1)} a year after inflation` })}
        {row("You have invested", money(b.invested, { whole: true }), { indent: true, tone: b.invested >= b.coastNow ? t.good : undefined })}
        <Divider />
        {row(b.invested >= b.coastNow ? "You've reached Coast FI" : "Still to go", b.invested >= b.coastNow ? "✓" : money(b.coastNow - b.invested, { whole: true }), { strong: true, tone: b.invested >= b.coastNow ? t.good : undefined })}
      </View>

      {step(5, "What your money supports")}
      <View style={[styles.box, { backgroundColor: t.surface2 }]}>
        {row("If you stopped saving today", per(b.coastSupports), { sub: `${money(b.invested, { whole: true })} grows to ${money(b.coastValue, { whole: true })} by ${d.retireAge}` })}
        {row("On your plan", per(b.planSupports), { sub: `About ${money(b.planValue, { whole: true })} by ${d.retireAge}` })}
        {row("You plan to spend", per(b.retireAnnual), { strong: true })}
      </View>
    </Card>
  );

  const ladder = (
    <Card style={{ gap: space.md }}>
      <SectionLabel>Other kinds of FI</SectionLabel>
      <Text style={[type.caption, { color: t.text3 }]}>The same math at other spending levels. Coast is reached when what you have invested today grows into that level's number by {d.retireAge}.</Text>
      {levels.map((l, i) => {
        // everything you'll spend is essential: Lean is the same as FI, so just say so
        if (l.key === "lean" && Math.abs(l.monthly - d.retireMonthly) < 0.5)
          return (
            <View key={l.key} style={{ gap: 4 }}>
              <Text style={[type.body, { color: t.text, fontWeight: "700" }]}>{l.label}</Text>
              <Text style={[type.caption, { color: t.text3 }]}>Same as FI: everything you'll spend in retirement is marked essential. Turn off Essential on a Budget category (travel, dining out) to see a leaner number.</Text>
            </View>
          );
        const done = d.invested >= l.coastNow;
        const when = done ? "Reached" : l.coastIn === null ? `Not before ${d.retireAge}` : l.coastIn === 0 ? "This month" : `Coast by ${monthLabel(start, l.coastIn)}`;
        return (
          <View key={l.key} style={{ gap: 4 }}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <Text style={[type.body, { color: t.text, fontWeight: "700", flex: 1 }]}>{l.label}</Text>
              <Pill tone={done ? "good" : l.key === "fi" ? "accent" : "neutral"}>{when}</Pill>
            </View>
            <Text style={[type.caption, { color: t.text3 }]}>
              {l.key === "lean" ? "Essentials only: budget items you'd keep in a money emergency, plus healthcare and housing costs." : l.key === "fi" ? "Your retirement spending, as planned." : `${FAT_FACTOR}× your retirement spending: room for more travel, gifts and comfort.`}
            </Text>
            {row("Spending", per(l.monthly * 12), { indent: true })}
            {row("FIRE number", money(l.fire, { whole: true }), { indent: true })}
            {row("Coast number today", money(l.coastNow, { whole: true }), { indent: true, tone: done ? t.good : undefined })}
          </View>
        );
      })}
      <Divider />
      <View style={{ gap: 4 }}>
        <View style={styles.row}>
          <Text style={[type.body, { color: t.text, fontWeight: "700", flex: 1 }]}>Barista FI</Text>
          <Pill tone="neutral">{`${money(barista.monthly, { whole: true })}/mo`}</Pill>
        </View>
        <Text style={[type.caption, { color: t.text3 }]}>
          If you stopped investing from your paycheck today: what you'd need to earn a month until {d.retireAge}, say from easier or part-time work, to pay your costs{barista.saving > 0.5 ? " and still reach your FIRE number" : ". You've reached Coast FI, so your costs are all"}.
        </Text>
        {row("Today's monthly costs", `${money(barista.costs, { whole: true })}/mo`, { indent: true })}
        {barista.saving > 0.5 ? row("Still to save to reach your number", `${money(barista.saving, { whole: true })}/mo`, { indent: true }) : null}
      </View>
      <Pressable role="link" onPress={() => router.push("/budget")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Mark what's essential on the Budget →</Text>
      </Pressable>
    </Card>
  );

  return (
    <>
      {breakdown}
      {ladder}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 3 },
  stepHead: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  box: { borderRadius: radius.md, padding: space.md, gap: 2 },
});
