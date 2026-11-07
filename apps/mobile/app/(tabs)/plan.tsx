import { coastNumberAt, isHighInterest, paysExtra } from "@coastfi/engine";
import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MonthlyCharts } from "../../components/MonthlyCharts";
import { budgetKeyFor } from "../../lib/budgetLinks";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { longMonth } from "../../components/AdjustmentsCard";
import { AccountsForecast } from "../../components/AccountsForecast";
import { Chip, FormList, FormRow, InlineMoney, Segmented, Select } from "../../components/form";
import { Icon } from "../../components/Icon";
import { ProgressBar } from "../../components/ProgressRing";
import { Card, Divider, Pill, Screen, SectionLabel } from "../../components/ui";
import { money, monthLabel } from "../../lib/format";
import { useLayout } from "../../lib/layout";
import { usePlan } from "../../lib/plan";
import { stepInfo, type StepInfo } from "../../lib/steps";
import { monthKey, useStore } from "../../lib/store";
import { radius, space, type, useTheme } from "../../lib/theme";

export default function Plan() {
  const t = useTheme();
  const { twoColumn, contentWidth } = useLayout();
  // phones: tighter rows, and the long explanations fold away
  const compact = contentWidth < 600;
  const [howOpen, setHowOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  // steps folded open to show their details, split and order buttons
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpenSteps((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const { state, result: o, start, actual } = usePlan();
  const router = useRouter();
  const thisMk = monthKey(start);
  const update = useStore((s) => s.update);
  // steps and accounts are two views of the same plan
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [tab, setTab] = useState<"steps" | "accounts" | "charts">(view === "charts" ? "charts" : view === "forecast" ? "accounts" : "steps");
  const tableView = tab === "accounts";

  // steps describe what you'll really do (no what-ifs), so they match Home's to-dos
  const real = { ...o, plan: actual };
  const infos = state.plan.steps.map((k) => stepInfo(k, state, real, start)).filter((x): x is StepInfo => !!x);
  // steps running now: the first unfinished one, plus the next ones while a step shares what's left
  const shares = state.plan.shares ?? {};
  // "Now": every step that gets money this month (several at once with shares, or when one finishes mid-month)
  const a0 = actual.months[0]?.alloc;
  const open = infos.filter((i) => !i.done && !i.skip);
  const firstOf = (pred: (k: string) => boolean) => open.find((i) => pred(i.key))?.key;
  const activeKeys = new Set<string>();
  if (a0) {
    const add = (k: string | undefined, amount: number) => { if (k && amount > 0.5) activeKeys.add(k); };
    add(firstOf((k) => k === "starterEF" || k === "fullEF"), a0.ef);
    add(firstOf((k) => k === "match"), a0.matchGain);
    add(firstOf((k) => k === "highDebt" || k === "lowDebt"), a0.debt);
    add(firstOf((k) => k === "hsa"), a0.hsa);
    add(firstOf((k) => k === "ira"), a0.ira);
    add(firstOf((k) => k === "k401"), a0.k401Step);
    add(firstOf((k) => k.startsWith("goal:")), a0.goals);
    add(firstOf((k) => k === "taxable"), a0.taxable);
  }
  if (!activeKeys.size && open[0]) activeKeys.add(open[0].key);
  const amounts = state.plan.amounts ?? {};
  const amountsBy = state.plan.amountsBy ?? {};
  /** A share (0–1) or a set amount per month; picking one clears the other. */
  const setSplit = (key: string, v: { share: number } | { amount: number }) =>
    update((p) => {
      const sh = { ...(p.plan.shares ?? {}) };
      const am = { ...(p.plan.amounts ?? {}) };
      const by = { ...(p.plan.amountsBy ?? {}) };
      delete sh[key];
      delete am[key];
      if ("amount" in v) am[key] = Math.max(0, v.amount);
      else if (v.share < 1) sh[key] = v.share;
      p.plan.shares = Object.keys(sh).length ? sh : undefined;
      p.plan.amounts = Object.keys(am).length ? am : undefined;
      p.plan.amountsBy = Object.keys(by).length ? by : undefined;
    });
  const move = (i: number, dir: -1 | 1) =>
    update((p) => {
      const s = p.plan.steps;
      const j = i + dir;
      if (j < 0 || j >= s.length) return;
      [s[i], s[j]] = [s[j]!, s[i]!];
    });

  // when each step starts getting money (month index), for the date labels between steps
  const months = actual.months;
  const firstMonth = (pred: (m: (typeof months)[number], i: number) => boolean) => {
    const i = months.findIndex(pred);
    return i < 0 ? null : i;
  };
  const highEnd = Math.max(
    -1,
    ...state.debts.filter((x) => paysExtra(x) && isHighInterest(x, state.plan.highApr) && x.balance > 0).map((x) => actual.events.find((e) => e.key === "debt:" + x.id)?.m ?? 1e9),
  );
  const startOf = (key: string): number | null => {
    if (key === "starterEF") return 0;
    if (key === "fullEF") return firstMonth((m, i) => m.alloc.ef > 0.5 && (i === 0 ? o.d.bal.cash : months[i - 1]!.cash) >= actual.starterTarget - 0.5);
    if (key === "match") return actual.events.find((e) => e.key === "match")?.m ?? null;
    if (key === "highDebt") return firstMonth((m) => m.alloc.debt > 0.5);
    if (key === "lowDebt") return firstMonth((m, i) => i > highEnd && m.alloc.debt > 0.5);
    if (key.startsWith("goal:")) return firstMonth((m) => m.alloc.goals > 0.5);
    if (key === "hsa" || key === "ira" || key === "k401" || key === "taxable") return actual.firstFund[key] ?? null;
    return null;
  };
  // a date label above the first step that starts in each month
  const dateLabel = (m: number) => (
    <View key={"d" + m} style={[styles.dateLabel, { backgroundColor: t.surface2 }, compact ? { paddingHorizontal: space.md } : null]}>
      <Text style={[type.overline, { color: t.accent }]}>{m === 0 ? "This month" : monthLabel(start, m)}</Text>
    </View>
  );
  let lastLabel = -1;

  const steps = (
    <Card padded={false} style={twoColumn ? { flex: 3 } : undefined}>
      <View style={{ padding: compact ? space.md : space.lg, paddingBottom: space.md, gap: 4 }}>
        <SectionLabel>Your steps</SectionLabel>
        {compact && !howOpen ? (
          <Pressable role="button" aria-expanded={false} onPress={() => setHowOpen(true)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" }}>
            <Text style={[type.caption, { color: t.text2 }]}>What's left fills these in order. <Text style={{ color: t.accent, fontWeight: "700" }}>How it works</Text></Text>
            <Icon name="chevron" size={12} color={t.accent} />
          </Pressable>
        ) : (
          <Text style={[compact ? type.caption : type.body, { color: t.text2 }]}>
            Whatever your budget doesn't assign to savings or debts fills step 1, then step 2, and so on. To fund two steps at once, give one a share of what's left. Tap a step for its details, to split what's left, or to change the order. The dates between steps show when each one starts.
          </Text>
        )}
      </View>
      <Divider />
      {infos.map((info, i) => {
        const active = activeKeys.has(info.key);
        const canShare = !info.done && !info.skip && info.key !== "taxable" && info.key !== "match" && i < infos.length - 1;
        const idx = state.plan.steps.indexOf(info.key);
        // a set amount a month fits steps you pay yourself; paycheck steps are set per check instead
        const canAmount = canShare && info.key !== "k401" && !(info.key === "hsa" && state.plan.hsaPayroll !== false);
        const amt = canAmount ? amounts[info.key] : undefined;
        const changed = Object.keys(amountsBy[info.key] ?? {}).length;
        const isOpen = openSteps.has(info.key);
        const parts = info.meta
          .replace(/ \(see (Plan → Forecast|the Accounts view)\)/g, "")
          .split(" · ")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => x.replace(/^./, (c) => c.toUpperCase()));
        // a very short first part ("Visa $3,000") reads better with the next one
        // closed: just the title (without its "(…)"), tags and progress; everything else when you tap it
        // only a trailing " (…)" ("401(k)" keeps its own parentheses)
        const paren = info.label.match(/^(.*\S)\s+\(([^()]*)\)\s*$/);
        const shortLabel = paren ? paren[1]! : info.label;
        const details = parts;
        const share = shares[info.key] ?? 1;
        const splitNote = canShare ? (amt !== undefined ? `gets ${money(amt, { whole: true })}/mo` : share < 1 ? `gets ${Math.round(share * 100)}% of what's left` : "") : "";
        const st = info.done || info.skip ? null : startOf(info.key);
        const labels = st !== null && st > lastLabel ? dateLabel(st) : null;
        if (st !== null && st > lastLabel) lastLabel = st;
        return (
          <View key={info.key}>
            {labels}
            <Pressable
              role="button"
              aria-expanded={isOpen}
              accessibilityLabel={`${info.label}: ${isOpen ? "hide" : "show"} details`}
              onPress={() => toggle(info.key)}
              style={({ pressed }) => [styles.step, compact ? { paddingHorizontal: space.md, gap: space.sm } : null, pressed ? { backgroundColor: t.surface2 } : null]}
            >
              <View style={[styles.num, { backgroundColor: info.done ? t.good : active ? t.accent : t.surface2 }]}>
                {info.done ? (
                  <Icon name="check" size={14} color="#fff" />
                ) : (
                  <Text style={[type.caption, { fontWeight: "700", color: active ? "#fff" : t.text2 }]}>{i + 1}</Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Text numberOfLines={isOpen ? undefined : 1} style={[type.body, { fontWeight: "600", color: info.done || info.skip ? t.text3 : t.text, flexShrink: 1 }]}>{isOpen ? info.label : shortLabel}</Text>
                  {active ? <Pill tone="accent">Now</Pill> : null}
                  {info.action ? <Pill tone="bad">To do</Pill> : null}
                </View>
                {splitNote ? <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{splitNote.replace(/^./, (ch) => ch.toUpperCase())}</Text> : null}
                {info.progress !== undefined && !info.done ? (
                  <View style={{ maxWidth: 280, marginTop: 3 }}>
                    <ProgressBar progress={info.progress} color={t.good} />
                  </View>
                ) : null}
              </View>
              <View style={{ transform: [{ rotate: isOpen ? "-90deg" : "90deg" }], opacity: 0.7 }}>
                <Icon name="chevron" size={14} color={t.text3} />
              </View>
            </Pressable>
            {isOpen ? (
              <View style={[styles.more, { marginLeft: compact ? 48 : 60, marginRight: compact ? space.md : space.lg }]}>
                {details.length ? (
                  <FormList>
                    {details.map((d, j) => (
                      <View key={j} style={styles.detailRow}>
                        <Text style={[type.caption, { color: t.text2, flex: 1 }]}>{d}</Text>
                      </View>
                    ))}
                  </FormList>
                ) : null}
                {(() => {
                  if (info.done || info.skip) return null;
                  // this step's line on the Budget tab (paycheck steps are set on the job instead)
                  const bk = budgetKeyFor(state, info.key, thisMk);
                  const got = bk ? state.budgetPlan?.months?.[thisMk]?.assigned?.[bk] : undefined;
                  const paycheck = !bk && (info.key === "k401" || info.key === "match" || info.key === "hsa");
                  const shareValue = amt !== undefined ? "amount" : String(shares[info.key] ?? 1);
                  return (
                    <FormList>
                      {bk || paycheck ? (
                        <Pressable
                          role="link"
                          onPress={() => router.push(bk ? `/budget?focus=${encodeURIComponent(bk)}` : "/money/income")}
                          style={({ pressed }) => [styles.linkRow, pressed ? { backgroundColor: t.surface2 } : null]}
                        >
                          <Text style={[type.body, { color: t.text, flex: 1 }]}>{paycheck ? "Set on your job" : "This month"}</Text>
                          <Text style={[type.body, { color: t.accent, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>
                            {paycheck ? "Per paycheck" : !state.budgetPlan ? "Budget for it" : got !== undefined ? `${money(got)} assigned` : "Assign on Budget"}
                          </Text>
                          <Icon name="chevron" size={14} color={t.accent} />
                        </Pressable>
                      ) : null}
                      {canShare ? (
                        <FormRow label="Share of what's left" hint="The rest goes to the next steps">
                          <Select
                            plain
                            label={`${info.label}: share of what's left`}
                            value={shareValue}
                            options={[
                              { value: "1", label: "All of it" },
                              { value: "0.75", label: "75%" },
                              { value: "0.5", label: "50%" },
                              { value: "0.25", label: "25%" },
                              ...(amt !== undefined ? [{ value: "amount", label: `${money(amt, { whole: true })} a month` }] : []),
                            ]}
                            onChange={(v) => { if (v !== "amount") setSplit(info.key, { share: Number(v) }); }}
                          />
                        </FormRow>
                      ) : null}
                      {canShare && amt !== undefined ? (
                        <FormRow label="Each month" hint={changed ? `${changed} month${changed === 1 ? "" : "s"} changed on the Budget tab` : undefined}>
                          <InlineMoney label={`${info.label}, amount a month`} value={amt} onChange={(v) => setSplit(info.key, { amount: v })} />
                        </FormRow>
                      ) : null}
                    </FormList>
                  );
                })()}
                <View style={styles.chipRow}>
                  <Chip title="Move up" icon="up" disabled={idx === 0} onPress={() => move(idx, -1)} />
                  <Chip title="Move down" icon="down" disabled={idx === state.plan.steps.length - 1} onPress={() => move(idx, 1)} />
                </View>
              </View>
            ) : null}
            {i < infos.length - 1 ? <View style={{ marginLeft: compact ? 48 : 60 }}><Divider /></View> : null}
          </View>
        );
      })}
    </Card>
  );


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
        {cmpRow("Following this plan", "Your steps, in order", o.projectedFinal, true)}
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
    // header and the Steps / Accounts switch stay put; the content scrolls under them, and the
    // accounts table fills the rest of the screen (scrolling inside, both ways)
    <Screen title="Plan" subtitle={compact ? undefined : "Your path to Coast FI"} fill maxWidth={100000}>
      <View style={{ maxWidth: 360 }}>
        <Segmented
          label="Plan view"
          options={[{ value: "steps", label: "Steps" }, { value: "accounts", label: "Forecast" }, { value: "charts", label: "Charts" }]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {tableView ? (
        <AccountsForecast state={state} o={real} start={start} fill />
      ) : tab === "charts" ? (
        <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ flex: 1, minHeight: 0, marginHorizontal: -space.sm }} contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: space.xxl }}>
          <MonthlyCharts />
        </ScrollView>
      ) : (
        <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ flex: 1, minHeight: 0, marginHorizontal: -space.sm }} contentContainerStyle={{ gap: space.lg, paddingHorizontal: space.sm, paddingBottom: space.xxl }}>
          {state.emergency?.active ? (
            <Card style={{ backgroundColor: t.warnSoft, borderColor: t.warn }}>
              <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Paused for emergency mode through {longMonth(state.emergency.until)}</Text>
              <Text style={[type.caption, { color: t.text2 }]}>Until then everything left over stays in cash. These steps pick up again the month after; the dates below already account for the pause.</Text>
            </Card>
          ) : null}
          {finish}
          {twoColumn ? (
            <View style={{ flexDirection: "row", gap: space.lg, alignItems: "flex-start" }}>
              {steps}
              <View style={{ flex: 2, gap: space.lg }}>{compare}</View>
            </View>
          ) : (
            <>
              {steps}
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
