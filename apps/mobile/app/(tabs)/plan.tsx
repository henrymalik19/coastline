import { coastNumberAt, investFromTakeHome, type AccountKey } from "@coastfi/engine";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSetView } from "../../lib/nav";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AccountsForecast } from "../../components/AccountsForecast";
import { AccountsProgress } from "../../components/AccountsProgress";
import { longMonth } from "../../components/AdjustmentsCard";
import { BalanceChart } from "../../components/BalanceChart";
import { InfoText, InfoTip, Segmented, Select } from "../../components/form";
import { Icon } from "../../components/Icon";
import { WhatIf } from "../../components/WhatIf";
import { NumberBreakdown } from "../../components/NumberBreakdown";
import { RetirementEssentials } from "../../components/RetirementEssentials";
import { HealthcareSection, RetirementIncomeSection } from "../../components/settings/sections";
import { ProgressBar } from "../../components/ProgressRing";
import { Card, Screen, SectionLabel } from "../../components/ui";
import { money, monthLabel } from "../../lib/format";
import { investedHistory, vsPlan } from "../../lib/history";
import { useStore } from "../../lib/store";
import { useLayout } from "../../lib/layout";
import { hasWhatIf, RealPlan, usePlan } from "../../lib/plan";
import { radius, space, type, useTheme } from "../../lib/theme";

// the answer first (your plan: your number and how you get there), then your accounts growing, what-ifs
// to try, and what sets your retirement. The keys stay as they were so old links still work.
type ViewKey = "overview" | "retirement" | "whatif" | "number";
const VIEWS: { value: ViewKey; label: string }[] = [
  { value: "number", label: "Your plan" },
  { value: "overview", label: "Accounts" },
  { value: "whatif", label: "What if" },
  { value: "retirement", label: "Retirement" },
];
const viewOf = (v?: string): ViewKey => (v === "retirement" || v === "whatif" || v === "overview" || v === "forecast" || v === "table" ? (v === "forecast" || v === "table" ? "overview" : v) : "number");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const keyLabel = (k: string) => `${MON[+k.slice(5) - 1]} ${k.slice(0, 4)}`;

/**
 * Forecast: where you're headed. Overview (the finish line, ahead of or behind the plan, your invested
 * balance over time, each account filling up), the month-by-month table, and what-ifs. This month's
 * to-dos are on Home. Your priority order lives in Settings.
 */
/** Every Forecast view but What if is your real plan: what you're trying out stays on What if. */
export default function ForecastScreen() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  return (
    <RealPlan.Provider value={viewOf(view) !== "whatif"}>
      <Forecast />
    </RealPlan.Provider>
  );
}

/** What-ifs are on (they show on What if, not here). */
function WhatIfsOnNote({ onOpen }: { onOpen: () => void }) {
  const t = useTheme();
  const on = useStore((s) => hasWhatIf(s.plan.whatif) || !!s.plan.adjustments?.length);
  if (!on) return null;
  return (
    <Text style={[type.caption, { color: t.text3 }]}>
      Your plan as you've set it.{" "}
      <Text role="link" onPress={onOpen} style={{ color: t.warn, fontWeight: "700" }}>You're trying what-ifs: see them →</Text>
    </Text>
  );
}

function Forecast() {
  const t = useTheme();
  const { twoColumn, contentWidth } = useLayout();
  const compact = contentWidth < 600;
  const [whyOpen, setWhyOpen] = useState(false);
  const { state, result: o, start, forecast, forecastReal, realD, whatIfOn } = usePlan();
  // the table: what you've set, with your what-ifs (what they change shows in orange)
  const real = { ...o, plan: forecast };
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [tab, setTab] = useState<ViewKey>(viewOf(view));
  // the month-by-month table: a way to look at the overview
  const [asTable, setAsTable] = useState(view === "forecast" || view === "table");
  // a link to another view while already here (Your number → Retirement)
  // the URL says which view (so the browser's Back button returns to the one before)
  useEffect(() => {
    setTab(viewOf(view));
    if (view === "forecast" || view === "table") setAsTable(true);
  }, [view]);
  const setView = useSetView();
  const router = useRouter();
  const checkins = useStore((s) => s.checkins);
  const vs = vsPlan(checkins, start);
  const [vsTip, setVsTip] = useState(false);
  const vsInfo = vs
    ? `Each month's end balance (your investments) compared with what the plan expected from the month before, added up since ${keyLabel(vs.since)}. Last month (${keyLabel(vs.lastMonth)}): ${money(Math.abs(vs.last), { whole: true })} ${vs.last >= 0 ? "ahead" : "behind"}. Markets swing, so a month behind is normal: the plan starts again from your real balances each month.`
    : "";
  // tapping an account in the overview opens its forecast in the table
  const [pick, setPick] = useState<string | undefined>(undefined);
  const openAccount = (key: AccountKey) => {
    setPick(key);
    setTab("overview");
    setAsTable(true);
  };
  const go = (v: ViewKey) => { setTab(v); setView({ view: v }); };

  // the finish line: when growth alone can carry you, so saving more becomes optional
  const coastM = o.crossing === null ? null : Math.round(o.crossing * 12);
  // the birthday you could stop investing (the first by which you have enough)
  const coastAge = o.crossing === null ? null : Math.ceil(o.d.age + o.crossing - 1e-9);
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
            retirement age, or Social Security or a pension (Forecast → Retirement) would get you there.
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
          <Text style={[type.title, compact ? { fontSize: 22, lineHeight: 28 } : null, { color: whatIfOn ? t.warn : t.text }]}>
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
        <View style={{ flexDirection: "row", gap: space.md, marginBottom: 4 }}>
          {[
            { k: "Coast FI number", v: o.coastNow, c: whatIfOn ? t.warn : t.text },
            { k: "Invested now", v: o.d.invested, c: t.text },
            { k: "Still to go", v: Math.max(0, o.coastNow - o.d.invested), c: whatIfOn ? t.warn : o.coastNow - o.d.invested <= 0.5 ? t.good : t.text },
          ].map((x) => (
            <View key={x.k} style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.caption, { color: t.text3 }]}>{x.k}</Text>
              <Text numberOfLines={1} style={[type.label, { color: x.c, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(x.v, { whole: true })}</Text>
            </View>
          ))}
        </View>
        <ProgressBar progress={o.progress} color={coastM === 0 ? t.good : t.accent} />
        <Text style={[type.caption, { color: t.text3 }]}>{Math.round(Math.min(1, o.progress) * 100)}% of the way. The number is what you'd need invested today; it rises a little each year.</Text>
        {vs ? (
          <>
            <View style={[styles.vsRow, { borderTopColor: t.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={[type.label, { color: vs.total >= 0 ? t.good : t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
                    {vs.total >= 0 ? "Ahead of plan by " : "Behind plan by "}
                    {money(Math.abs(vs.total), { whole: true })}
                  </Text>
                  <Text style={[type.caption, { color: t.text3 }]}>Your balances vs what your plan expected, since {keyLabel(vs.since)}</Text>
                </View>
                <InfoTip text={vsInfo} label="Ahead or behind plan" open={vsTip} onToggle={setVsTip} />
              </View>
            </View>
            {vsTip ? <InfoText text={vsInfo} /> : null}
          </>
        ) : (
          <Text style={[type.caption, { color: t.text3, paddingTop: space.xs }]}>Ahead of or behind plan shows here after your first full month.</Text>
        )}
        <Pressable role="link" onPress={() => go("number")} hitSlop={6} style={{ alignSelf: "flex-start", paddingTop: space.xs }}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>See your plan: how you get there →</Text>
        </Pressable>
      </View> : null}
    </Card>
  );

  const selfInvest = investFromTakeHome(state);
  const better = o.projectedFinal >= o.altFinal;
  const diff = o.projectedFinal - o.altFinal;
  const cmpRow = (labelText: string, hint: string, value: number, strong: boolean) => (
    <View style={styles.cmpRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: t.text, fontWeight: strong ? "700" : "500" }]}>{labelText}</Text>
        <Text style={[type.caption, { color: t.text3 }]}>{hint}</Text>
      </View>
      <Text style={[type.heading, { color: whatIfOn ? t.warn : strong ? t.text : t.text2, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(value, { whole: true })}</Text>
    </View>
  );
  const compare = (
    <Card style={{ gap: space.sm }}>
      <SectionLabel>Why follow the plan?</SectionLabel>
      <Text style={[type.caption, { color: t.text3, marginTop: -space.xs }]}>Invested by age {o.d.retireAge}, at your assumed return (no market swings)</Text>
      <View style={[styles.cmpBox, { borderColor: t.border }]}>
        {cmpRow("Following this plan", "Your priority order", o.projectedFinal, true)}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />
        {cmpRow(
          "Keeping things as they are",
          `Your paycheck 401(k) and HSA, plus ${money(selfInvest.monthly, { whole: true })}/mo you invest yourself${selfInvest.fromBudget ? " (from your Budget)" : ""}. Everything else stays in cash.`,
          o.altFinal,
          false,
        )}
      </View>
      {better && diff > 0.5 ? (
        <View style={[styles.cmpDiff, { backgroundColor: t.goodSoft }]}>
          <Text style={[type.body, { color: t.text, flex: 1 }]}>The plan comes out ahead by</Text>
          <Text style={[type.heading, { color: whatIfOn ? t.warn : t.good, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(diff, { whole: true })}</Text>
        </View>
      ) : null}
    </Card>
  );

  return (
    <Screen title="Forecast" subtitle={compact ? undefined : "Where you're headed"} fill>
      <View style={{ maxWidth: compact ? undefined : 480 }}>
        {compact ? (
          <Select label="Forecast view" options={VIEWS} value={tab} onChange={(v) => { go(v); setPick(undefined); }} />
        ) : (
          <Segmented label="Forecast view" options={VIEWS} value={tab} onChange={(v) => { go(v); setPick(undefined); }} />
        )}
      </View>
      {tab === "overview" ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {[{ v: false, label: "Chart" }, { v: true, label: "Table" }].map((x) => (
            <Pressable key={x.label} role="radio" aria-checked={asTable === x.v} aria-label={x.label} onPress={() => { setAsTable(x.v); if (!x.v) setPick(undefined); }} hitSlop={4} style={[styles.chip, { borderColor: asTable === x.v ? t.accent : t.border, backgroundColor: asTable === x.v ? t.accentSoft : t.surface }]}>
              <Text style={[type.caption, { color: asTable === x.v ? t.accent : t.text2, fontWeight: "700" }]}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {tab === "overview" && asTable ? (
        <Text style={[type.caption, { color: t.text3 }]}>
          Left is the money you haven't given a job each month. Your plan fills it in your priority order. Tap any amount to set it yourself.
        </Text>
      ) : null}
      {tab === "overview" && asTable ? <WhatIfsOnNote onOpen={() => go("whatif")} /> : null}
      {tab === "overview" && asTable ? (
        <AccountsForecast key={pick ?? "all"} state={state} o={real} start={start} fill initialPick={pick} compare={whatIfOn ? { plan: forecastReal, d: realD } : undefined} />
      ) : tab === "whatif" ? (
        <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ flex: 1, minHeight: 0, marginHorizontal: -space.sm }} contentContainerStyle={{ gap: space.lg, paddingHorizontal: space.sm, paddingBottom: space.xxl }}>
          <WhatIf />
          <Pressable role="link" onPress={() => go("number")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>See your plan →</Text>
          </Pressable>
        </ScrollView>
      ) : tab === "retirement" ? (
        // everything that sets your retirement number, with the number up top so a change shows right away
        <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ flex: 1, minHeight: 0, marginHorizontal: -space.sm }} contentContainerStyle={{ gap: space.lg, paddingHorizontal: space.sm, paddingBottom: space.xxl }}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.caption, { color: t.text3 }]}>Your FIRE number</Text>
              <Text style={[type.title, { color: whatIfOn ? t.warn : t.text, fontVariant: ["tabular-nums"] }]}>{money(o.fire, { whole: true })}</Text>
              <Text style={[type.caption, { color: t.text3 }]}>Changes below update it right away</Text>
            </View>
            <Pressable role="link" onPress={() => go("number")} hitSlop={6}>
              <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>See your plan →</Text>
            </Pressable>
          </Card>
          {twoColumn ? (
            // wide screens: spending (the long list) on the left, income and healthcare beside it
            <View style={{ flexDirection: "row", gap: space.lg, alignItems: "flex-start" }}>
              <View style={{ flex: 3, minWidth: 0, gap: space.lg }}>
                <SectionLabel>What you'll spend</SectionLabel>
                <RetirementEssentials />
              </View>
              <View style={{ flex: 2, minWidth: 0, gap: space.lg }}>
                <SectionLabel>Income in retirement</SectionLabel>
                <RetirementIncomeSection />
                <SectionLabel>Healthcare</SectionLabel>
                <HealthcareSection />
              </View>
            </View>
          ) : (
            <>
              <SectionLabel>What you'll spend</SectionLabel>
              <RetirementEssentials />
              <SectionLabel>Income in retirement</SectionLabel>
              <RetirementIncomeSection />
              <SectionLabel>Healthcare</SectionLabel>
              <HealthcareSection />
            </>
          )}
        </ScrollView>
      ) : tab === "number" ? (
        <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ flex: 1, minHeight: 0, marginHorizontal: -space.sm }} contentContainerStyle={{ gap: space.lg, paddingHorizontal: space.sm, paddingBottom: space.xxl }}>
          <NumberBreakdown onView={go} />
        </ScrollView>
      ) : (
        <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ flex: 1, minHeight: 0, marginHorizontal: -space.sm }} contentContainerStyle={{ gap: space.lg, paddingHorizontal: space.sm, paddingBottom: space.xxl }}>
          <WhatIfsOnNote onOpen={() => go("whatif")} />
          {state.emergency?.active ? (
            <Card style={{ backgroundColor: t.warnSoft, borderColor: t.warn }}>
              <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Paused for emergency mode through {longMonth(state.emergency.until)}</Text>
              <Text style={[type.caption, { color: t.text2 }]}>Until then everything left over stays in cash. The dates below already account for the pause.</Text>
            </Card>
          ) : null}
          {finish}
          <BalanceChart o={o} history={investedHistory(checkins, o.d.invested, start)} start={start} height={twoColumn ? 300 : 240} />
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
  vsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, marginTop: space.sm, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  cmpBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: "hidden" },
  cmpRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md },
  cmpDiff: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
});

