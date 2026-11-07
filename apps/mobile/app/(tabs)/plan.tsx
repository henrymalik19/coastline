import { coastNumberAt, type AccountKey } from "@coastfi/engine";
import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AccountsForecast } from "../../components/AccountsForecast";
import { AccountsProgress } from "../../components/AccountsProgress";
import { longMonth } from "../../components/AdjustmentsCard";
import { Segmented } from "../../components/form";
import { Icon } from "../../components/Icon";
import { MonthlyCharts } from "../../components/MonthlyCharts";
import { ProgressBar } from "../../components/ProgressRing";
import { Card, Screen, SectionLabel } from "../../components/ui";
import { money, monthLabel } from "../../lib/format";
import { useLayout } from "../../lib/layout";
import { usePlan } from "../../lib/plan";
import { radius, space, type, useTheme } from "../../lib/theme";

/**
 * Forecast: where you're headed. Overview (the finish line, each account filling up, and what the plan
 * is worth), the month-by-month table, and charts. Your priority order lives in Settings.
 */
export default function Forecast() {
  const t = useTheme();
  const { twoColumn, contentWidth } = useLayout();
  const compact = contentWidth < 600;
  const [whyOpen, setWhyOpen] = useState(false);
  const { state, result: o, start, actual } = usePlan();
  const real = { ...o, plan: actual };
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [tab, setTab] = useState<"overview" | "table" | "charts">(view === "charts" ? "charts" : view === "forecast" || view === "table" ? "table" : "overview");
  // tapping an account in the overview opens its forecast in the table
  const [pick, setPick] = useState<string | undefined>(undefined);
  const openAccount = (key: AccountKey) => {
    setPick(key);
    setTab("table");
  };

  // the finish line: when growth alone can carry you, so saving more becomes optional
  const coastM = o.crossing === null ? null : Math.round(o.crossing * 12);
  const coastAge = o.crossing === null ? null : Math.floor(o.d.age + o.crossing);
  const coastAt = o.crossing === null ? 0 : coastNumberAt(o.fire, o.d.r, o.d.years - o.crossing);
  const why = !compact || whyOpen;
  const whyToggle = compact ? (
    <Pressable role="button" aria-expanded={whyOpen} onPress={() => setWhyOpen((v) => !v)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" }}>
      <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{whyOpen ? "Less" : "What this means"}</Text>
      <View style={{ transform: [{ rotate: whyOpen ? "-90deg" : "90deg" }] }}>
        <Icon name="chevron" size={12} color={t.accent} />
      </View>
    </Pressable>
  ) : null;
  const finish = (
    <Card style={{ gap: space.sm, borderColor: coastM === null ? t.border : t.accent }}>
      <SectionLabel>Your finish line</SectionLabel>
      {o.fire <= 0 ? (
        <>
          <Text style={[type.title, { color: t.text }]}>Add your budget to see it</Text>
          <Text style={[type.body, { color: t.text2 }]}>
            Your finish line depends on what you'll spend in retirement. Fill in your monthly budget (Money → Monthly budget) and mark what you'll still pay after you retire.
          </Text>
        </>
      ) : coastM === null ? (
        <>
          <Text style={[type.title, { color: t.text }]}>Not reached by {o.d.retireAge} yet</Text>
          {why ? <Text style={[type.body, { color: t.text2 }]}>
            At this pace your savings won't grow to your retirement number ({money(o.fire, { whole: true })}) on their own by age {o.d.retireAge}. Saving more each month, a later
            retirement age, or Social Security or a pension (Money → Income in retirement) would get you there.
          </Text> : null}
          {whyToggle}
        </>
      ) : coastM === 0 ? (
        <>
          <Text style={[type.title, { color: t.good }]}>You've reached Coast FI</Text>
          {why ? <Text style={[type.body, { color: t.text2 }]}>
            What you've invested ({money(o.d.invested, { whole: true })}) can grow to your retirement number ({money(o.fire, { whole: true })}) by age {o.d.retireAge} on its own.
            You only need to cover your bills. Anything you invest from here is optional and lets you retire earlier.
          </Text> : null}
          {whyToggle}
        </>
      ) : (
        <>
          <Text style={[type.title, compact ? { fontSize: 22, lineHeight: 28 } : null, { color: t.text }]}>
            Coast FI in {monthLabel(start, coastM)}
            {coastAge !== null ? <Text style={{ color: t.text3 }}> · age {coastAge}</Text> : null}
          </Text>
          {why ? <Text style={[type.body, { color: t.text2 }]}>
            Once you have about {money(coastAt, { whole: true })} invested, it can grow to your retirement number ({money(o.fire, { whole: true })}) by age {o.d.retireAge} on its own.
            From then on you only need to cover your bills. Investing more is optional and lets you retire earlier.
          </Text> : null}
          {whyToggle}

        </>
      )}
      {o.fire > 0 ? <View style={{ gap: 4, marginTop: space.xs }}>
        <ProgressBar progress={o.progress} color={coastM === 0 ? t.good : t.accent} />
        <Text style={[type.caption, { color: t.text3 }]}>{Math.round(Math.min(1, o.progress) * 100)}% of the way to Coast FI today</Text>
      </View> : null}
    </Card>
  );

  const better = o.projectedFinal >= o.altFinal;
  const diff = o.projectedFinal - o.altFinal;
  const cmpRow = (labelText: string, hint: string, value: number, strong: boolean) => (
    <View style={styles.cmpRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: t.text, fontWeight: strong ? "700" : "500" }]}>{labelText}</Text>
        <Text style={[type.caption, { color: t.text3 }]}>{hint}</Text>
      </View>
      <Text style={[type.heading, { color: strong ? t.text : t.text2, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(value, { whole: true })}</Text>
    </View>
  );
  const compare = (
    <Card style={{ gap: space.sm }}>
      <SectionLabel>Why follow the plan?</SectionLabel>
      <Text style={[type.caption, { color: t.text3, marginTop: -space.xs }]}>Invested by age {o.d.retireAge}, at your assumed return (no market swings)</Text>
      <View style={[styles.cmpBox, { borderColor: t.border }]}>
        {cmpRow("Following this plan", "Your priority order", o.projectedFinal, true)}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />
        {cmpRow("Keeping things as they are", `Investing ${money(state.currentInvestMonthly, { whole: true })}/mo like today`, o.altFinal, false)}
      </View>
      {better && diff > 0.5 ? (
        <View style={[styles.cmpDiff, { backgroundColor: t.goodSoft }]}>
          <Text style={[type.body, { color: t.text, flex: 1 }]}>The plan comes out ahead by</Text>
          <Text style={[type.heading, { color: t.good, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(diff, { whole: true })}</Text>
        </View>
      ) : null}
    </Card>
  );

  return (
    <Screen title="Forecast" subtitle={compact ? undefined : "Where you're headed"} fill maxWidth={100000}>
      <View style={{ maxWidth: 360 }}>
        <Segmented
          label="Forecast view"
          options={[{ value: "overview", label: "Overview" }, { value: "table", label: "Table" }, { value: "charts", label: "Charts" }]}
          value={tab}
          onChange={(v) => { setTab(v); if (v !== "table") setPick(undefined); }}
        />
      </View>
      {tab === "table" ? (
        <AccountsForecast key={pick ?? "all"} state={state} o={real} start={start} fill initialPick={pick} />
      ) : tab === "charts" ? (
        <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ flex: 1, minHeight: 0, marginHorizontal: -space.sm }} contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: space.xxl }}>
          <MonthlyCharts />
        </ScrollView>
      ) : (
        <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ flex: 1, minHeight: 0, marginHorizontal: -space.sm }} contentContainerStyle={{ gap: space.lg, paddingHorizontal: space.sm, paddingBottom: space.xxl }}>
          {state.emergency?.active ? (
            <Card style={{ backgroundColor: t.warnSoft, borderColor: t.warn }}>
              <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Paused for emergency mode through {longMonth(state.emergency.until)}</Text>
              <Text style={[type.caption, { color: t.text2 }]}>Until then everything left over stays in cash. The dates below already account for the pause.</Text>
            </Card>
          ) : null}
          {finish}
          {twoColumn ? (
            <View style={{ flexDirection: "row", gap: space.lg, alignItems: "flex-start" }}>
              <View style={{ flex: 3 }}><AccountsProgress onOpen={openAccount} /></View>
              <View style={{ flex: 2, gap: space.lg }}>{compare}</View>
            </View>
          ) : (
            <>
              <AccountsProgress onOpen={openAccount} />
              {compare}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  step: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  moves: { flexDirection: "row", alignItems: "center" },
  more: { gap: space.sm, paddingBottom: space.md },
  budgetLink: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  detailRow: { paddingHorizontal: space.md, paddingVertical: 10 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, minHeight: 50 },
  chipRow: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  moveBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  dateLabel: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 6 },
  cmp: { flexDirection: "row", gap: space.lg },
  cmpBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: "hidden" },
  cmpRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md },
  cmpDiff: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
});

