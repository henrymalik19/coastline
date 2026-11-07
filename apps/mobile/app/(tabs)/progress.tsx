import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, NumberInput } from "../../components/form";
import { ProgressBar } from "../../components/ProgressRing";
import { ProjectionChart } from "../../components/ProjectionChart";
import { Slider } from "../../components/Slider";
import { Legend } from "../../components/StackedBars";
import { Card, Divider, Pill, Screen, SectionLabel } from "../../components/ui";
import { badgeList, streakInfo } from "../../lib/badges";
import { debtLabel } from "../../lib/debts";
import { money, monthLabel, percent } from "../../lib/format";
import { useLayout } from "../../lib/layout";
import { usePlan } from "../../lib/plan";
import { monthKey, useStore } from "../../lib/store";
import { radius, space, type, useTheme } from "../../lib/theme";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TYPE_LABEL = { pretax: "Pre-tax", roth: "Roth", taxable: "Brokerage", hsa: "HSA", cash: "Cash" } as const;

export default function Progress() {
  const t = useTheme();
  const { twoColumn, statColumns } = useLayout();
  const { state, result: o, start } = usePlan();
  const router = useRouter();
  const update = useStore((s) => s.update);
  const checkins = useStore((s) => s.checkins);
  const logCheckin = useStore((s) => s.logCheckin);
  const [sel, setSel] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [msg, setMsg] = useState("");
  const [spent, setSpent] = useState(0);
  const d = o.d;
  const w = state.whatif;

  const streak = streakInfo(checkins, start);
  const badges = badgeList(state, o, streak);
  const got = badges.filter((b) => b.got).length;
  const next = badges.filter((b) => !b.got && b.eta !== null).sort((a, b) => a.eta! - b.eta!)[0];
  const avgContrib = d.years ? o.plan.months.slice(0, d.years * 12).reduce((a, m) => a + m.pre + m.post, 0) / d.years : 0;
  const whatIfActive = !!(w.extra || w.retDelta || w.spendDelta);

  /* ---------- top stats ---------- */
  const freedom = (
    <Card style={{ flex: 1, gap: 4 }}>
      <SectionLabel>Freedom bought so far</SectionLabel>
      <Text style={[type.display, { color: t.text }]}>{Number.isFinite(o.freedomDays) ? `${Math.round(o.freedomDays).toLocaleString("en-US")} days` : "∞"}</Text>
      <Text style={[type.caption, { color: t.text2 }]}>
        Your investments could cover {Number.isFinite(o.freedomDays) ? (o.freedomDays / 365).toFixed(1) : "∞"} years of retirement spending today. Every{" "}
        <Text style={{ fontWeight: "700", color: t.text }}>{money(d.retireAnnual / 365)}</Text> invested buys one more day.
        {o.coastSoonerMonths ? ` An extra $100/month pulls Coast FI about ${o.coastSoonerMonths} month${o.coastSoonerMonths > 1 ? "s" : ""} sooner.` : ""}
      </Text>
    </Card>
  );
  const streakCard = (
    <Card style={{ flex: 1, gap: 6 }}>
      <SectionLabel>Check-in streak</SectionLabel>
      <Text style={[type.display, { color: t.text }]}>{streak.n} {streak.n === 1 ? "month" : "months"}</Text>
      <View style={styles.months} role="img" aria-label={`Checked in ${streak.last12.filter((x) => x.done).length} of the last 12 months`}>
        {streak.last12.map((m) => (
          <View key={m.key} style={[styles.monthDot, { backgroundColor: m.done ? t.good : t.surface2, borderColor: m.done ? t.good : t.border }]} />
        ))}
      </View>
      <Text style={[type.caption, { color: t.text2 }]}>
        {streak.thisMonth ? "Checked in this month ✓" : streak.n ? "Check in this month to keep it going." : "Log your first check-in to start a streak."}
      </Text>
    </Card>
  );
  const level = (
    <Card style={{ flex: 1, gap: 6 }}>
      <SectionLabel>Level</SectionLabel>
      <Text style={[type.display, { color: t.text }]}>Level {got + 1}</Text>
      <ProgressBar progress={got / badges.length} />
      <Text style={[type.caption, { color: t.text2 }]}>
        {got} of {badges.length} badges.{next ? ` Next up: ${next.title} (${next.eta === 0 ? "this month" : monthLabel(start, next.eta!)}).` : ""}
      </Text>
    </Card>
  );

  /* ---------- projection ---------- */
  const b = sel !== null ? o.mc.bands[sel] : null;
  const projection = (
    <Card style={{ gap: space.md }}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <SectionLabel>Invested balance vs. your Coast FI line</SectionLabel>
          <Text style={[type.heading, { color: t.text, marginTop: -4 }]}>
            {percent(o.mc.probFire)} odds of reaching FIRE by {d.retireAge}
          </Text>
        </View>
        <Button title={table ? "Show chart" : "Show table"} onPress={() => setTable((v) => !v)} />
      </View>
      <Legend
        items={[
          { key: "m", label: "Median projection", color: t.series.k401 },
          { key: "b", label: "Middle 50% / 80% of outcomes", color: t.accentSoft },
          { key: "c", label: "Coast FI number", color: t.series.ira },
          { key: "f", label: "FIRE number (dashed)", color: t.text3 },
        ]}
      />
      {table ? (
        <ScrollView horizontal>
          <View>
            <View style={[styles.tr, { borderBottomColor: t.border }]}>
              {["Age", "10th pct", "Median", "90th pct", "Coast FI #", "FIRE #"].map((h, i) => (
                <Text key={h} style={[styles.th, i ? styles.cn : styles.c0, { color: t.text3 }]}>{h}</Text>
              ))}
            </View>
            {o.mc.bands.map((bd, i) => (
              <View key={i} style={[styles.tr, { borderBottomColor: t.border }]}>
                <Text style={[styles.td, styles.c0, { color: t.text }]}>{d.age + i}</Text>
                {[bd.p10, bd.p50, bd.p90, o.coastCurve[i]!, o.fire].map((v, j) => (
                  <Text key={j} style={[styles.td, styles.cn, { color: j === 1 ? t.text : t.text2, fontWeight: j === 1 ? "600" : "400" }]}>{money(v)}</Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <>
          <ProjectionChart bands={o.mc.bands} coastCurve={o.coastCurve} fire={o.fire} age={d.age} crossing={o.crossing} height={twoColumn ? 340 : 280} selected={sel} onSelect={setSel} />
          <View style={[styles.detail, { backgroundColor: t.surface2 }]} role="status">
            {b && sel !== null ? (
              <View style={styles.detailGrid}>
                <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Age {d.age + sel}</Text>
                <Text style={[type.caption, { color: t.text2 }]}>Median <Text style={{ color: t.text, fontWeight: "700" }}>{money(b.p50, { compact: true })}</Text></Text>
                <Text style={[type.caption, { color: t.text2 }]}>Middle 50% <Text style={{ color: t.text, fontWeight: "600" }}>{money(b.p25, { compact: true })}–{money(b.p75, { compact: true })}</Text></Text>
                <Text style={[type.caption, { color: t.text2 }]}>80% range <Text style={{ color: t.text, fontWeight: "600" }}>{money(b.p10, { compact: true })}–{money(b.p90, { compact: true })}</Text></Text>
                <Text style={[type.caption, { color: t.text2 }]}>Coast FI # <Text style={{ color: t.text, fontWeight: "600" }}>{money(o.coastCurve[sel]!, { compact: true })}</Text></Text>
              </View>
            ) : (
              <Text style={[type.caption, { color: t.text3 }]}>Hover or tap the chart to see a year's range.</Text>
            )}
          </View>
        </>
      )}
      <Text style={[type.caption, { color: t.text3 }]}>
        Assumes {percent(d.r, 2)} real return after fees, {percent(d.vol)} volatility, about {money(avgContrib, { compact: true })}/yr in contributions (
        {o.plan.mode === "plan" ? "following your plan" : "what you invest today"}). Bands are 2,000 simulated market paths, not guarantees.
      </Text>
    </Card>
  );

  /* ---------- what-ifs ---------- */
  const whatIfs = (
    <Card style={{ gap: space.md }}>
      <View style={styles.between}>
        <SectionLabel>What if…</SectionLabel>
        {whatIfActive ? <Pill tone="warn">What-ifs are on</Pill> : null}
      </View>
      <View style={[styles.sliders, { flexDirection: twoColumn ? "row" : "column" }]}>
        <SliderRow label="Extra saved per month" value={`+${money(w.extra)}`}>
          <Slider label="Extra saved per month" valueText={money(w.extra)} value={w.extra} min={0} max={2000} step={50} onChange={(v) => update((p) => { p.whatif.extra = v; })} />
        </SliderRow>
        <SliderRow label="Returns vs. assumption" value={`${w.retDelta >= 0 ? "+" : "−"}${Math.abs(w.retDelta * 100).toFixed(2).replace(/\.?0+$/, "")} pts`}>
          <Slider label="Returns versus assumption" valueText={`${(w.retDelta * 100).toFixed(2)} points`} value={w.retDelta * 100} min={-3} max={2} step={0.25} onChange={(v) => update((p) => { p.whatif.retDelta = v / 100; })} />
        </SliderRow>
        <SliderRow label="Retirement spending" value={`${w.spendDelta >= 0 ? "+" : "−"}${Math.abs(Math.round(w.spendDelta * 100))}%`}>
          <Slider label="Retirement spending change" valueText={`${Math.round(w.spendDelta * 100)} percent`} value={w.spendDelta * 100} min={-40} max={40} step={5} onChange={(v) => update((p) => { p.whatif.spendDelta = v / 100; })} />
        </SliderRow>
        <SliderRow label="Retire at" value={String(state.retireAge)}>
          <Slider label="Retirement age" valueText={`age ${state.retireAge}`} value={state.retireAge} min={Math.max(state.age + 1, 35)} max={75} step={1} onChange={(v) => update((p) => { p.retireAge = v; })} />
        </SliderRow>
      </View>
      <View style={[styles.between, { flexWrap: "wrap" }]}>
        <Text style={[type.caption, { color: t.text3, flex: 1 }]}>Extra savings flow through your plan's priority order. Retire-at changes your actual target.</Text>
        <Button title="Reset what-ifs" disabled={!whatIfActive} onPress={() => update((p) => { p.whatif = { extra: 0, retDelta: 0, spendDelta: 0 }; })} />
      </View>
    </Card>
  );

  // spending vs. budget over the last check-ins that recorded it: nudge if off by more than 10%
  const withSpend = checkins.filter((c) => c.spent !== undefined).slice(-3);
  const avgSpent = withSpend.length ? withSpend.reduce((a, c) => a + c.spent!, 0) / withSpend.length : 0;
  const budgetHint =
    withSpend.length >= 2 && d.monthlyExpenses > 0 && Math.abs(avgSpent - d.monthlyExpenses) / d.monthlyExpenses > 0.1
      ? { n: withSpend.length, avg: avgSpent }
      : null;
  // gentle note when the most recent check-in came in under last month's projection
  const lastTwo = checkins.slice(-2);
  const latestBehind = lastTwo.length === 2 && lastTwo[1]!.invested < lastTwo[0]!.expectedNextInvested - 1;

  /* ---------- check-in ---------- */
  const log = () => {
    const key = monthKey(start);
    const before = streak.n;
    logCheckin({
      month: key,
      date: start.toISOString().slice(0, 10),
      invested: d.invested,
      cash: d.bal.cash,
      debt: d.debtTotal,
      netWorth: d.invested + d.bal.cash + state.goals.reduce((a, g) => a + (+g.saved || 0), 0) - d.debtTotal,
      expectedNextInvested: o.projSeries.length > 1 ? o.projSeries[1]! : d.invested,
      ...(spent > 0 ? { spent, budget: d.monthlyExpenses } : {}),
    });
    const after = streakInfo([...checkins.filter((c) => c.month !== key), { month: key, invested: 0, cash: 0, debt: 0, netWorth: 0, expectedNextInvested: 0 }], start).n;
    setMsg(after > before ? `Checked in. Streak: ${after} month${after > 1 ? "s" : ""} 🔥` : "Updated this month's check-in.");
  };
  const checkin = (
    <Card style={{ flex: 1, gap: space.sm }}>
      <SectionLabel>Monthly check-in</SectionLabel>
      <Text style={[type.caption, { color: t.text2 }]}>Update your balances, then log. Takes two minutes and keeps the streak alive.</Text>
      {state.accounts.map((a, i) => (
        <View key={a.id} style={styles.ciRow}>
          <Text style={[type.body, { color: t.text, flex: 1 }]} numberOfLines={1}>
            {a.name} <Text style={[type.caption, { color: t.text3 }]}>{TYPE_LABEL[a.type]}</Text>
          </Text>
          <NumberInput kind="money" label={`${a.name} balance`} value={a.balance} min={0} onChange={(v) => update((p) => { p.accounts[i]!.balance = v; })} />
        </View>
      ))}
      {state.debts.map((x, i) => (
        <View key={x.id} style={styles.ciRow}>
          <Text style={[type.body, { color: t.text, flex: 1 }]} numberOfLines={1}>
            {debtLabel(x)} <Text style={[type.caption, { color: t.text3 }]}>debt</Text>
          </Text>
          <NumberInput kind="money" label={`${debtLabel(x)} balance`} value={x.balance} min={0} onChange={(v) => update((p) => { p.debts[i]!.balance = v; })} />
        </View>
      ))}
      {state.goals.map((g, i) => (
        <View key={g.id} style={styles.ciRow}>
          <Text style={[type.body, { color: t.text, flex: 1 }]} numberOfLines={1}>
            {g.name} <Text style={[type.caption, { color: t.text3 }]}>saved</Text>
          </Text>
          <NumberInput kind="money" label={`${g.name} saved`} value={g.saved} min={0} onChange={(v) => update((p) => { p.goals[i]!.saved = v; })} />
        </View>
      ))}
      <View style={[styles.spentBox, { backgroundColor: t.surface2 }]}>
        <View style={styles.ciRow}>
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: t.text }]}>About how much did you spend this month?</Text>
            <Text style={[type.caption, { color: t.text3 }]}>
              Optional. Bills, groceries, fun, debt minimums: everything except saving and investing. Your budget is {money(d.monthlyExpenses)}.
            </Text>
          </View>
          <NumberInput kind="money" label="About how much you spent this month" value={spent} onChange={setSpent} step={100} />
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.sm, flexWrap: "wrap" }}>
        <Button title={streak.thisMonth ? "Update check-in" : "Log check-in"} tone="primary" onPress={log} />
        {msg ? <Text role="status" style={[type.label, { color: t.good }]}>{msg}</Text> : null}
      </View>
    </Card>
  );

  const history = (
    <Card style={{ flex: 1.3, gap: space.sm }}>
      <SectionLabel>History vs. plan</SectionLabel>
      {checkins.length ? (
        <>
          {budgetHint ? (
            <View style={[styles.hint, { backgroundColor: t.warnSoft }]}>
              <Text style={[type.caption, { color: t.text, flex: 1 }]}>
                Your last {budgetHint.n} check-ins averaged <Text style={{ fontWeight: "700" }}>{money(budgetHint.avg)}</Text> of spending vs. your{" "}
                <Text style={{ fontWeight: "700" }}>{money(d.monthlyExpenses)}</Text> budget. A realistic budget makes the whole plan more accurate.
              </Text>
              <Button title="Update budget" onPress={() => router.push("/money/budget")} />
            </View>
          ) : null}
          <View style={[styles.tr, { borderBottomColor: t.border }]}>
            <Text style={[styles.th, { flex: 1, color: t.text3 }]}>Month</Text>
            <Text style={[styles.th, { flex: 1, textAlign: "right", color: t.text3 }]}>Invested</Text>
            <Text style={[styles.th, { flex: 1, textAlign: "right", color: t.text3 }]}>Spending</Text>
            <Text style={[styles.th, { flex: 1.2, textAlign: "right", color: t.text3 }]}>vs. plan</Text>
          </View>
          {[...checkins].reverse().map((c) => {
            const i = checkins.findIndex((x) => x.month === c.month);
            const prev = checkins[i - 1];
            const diff = prev ? c.invested - prev.expectedNextInvested : null;
            const over = c.spent !== undefined && c.budget !== undefined ? c.spent - c.budget : null;
            return (
              <View key={c.month} style={[styles.tr, { borderBottomColor: t.border }]}>
                <Text style={[styles.td, { flex: 1, color: t.text }]}>{MON[+c.month.slice(5) - 1]} {c.month.slice(0, 4)}</Text>
                <Text style={[styles.td, { flex: 1, textAlign: "right", color: t.text2 }]}>{money(c.invested)}</Text>
                <Text style={[styles.td, { flex: 1, textAlign: "right", color: over === null ? t.text3 : over > 0 ? t.warn : t.good }]}>
                  {over === null ? "–" : over > 0 ? `${money(over)} over` : `${money(-over)} under`}
                </Text>
                <Text style={[styles.td, { flex: 1.2, textAlign: "right", color: diff === null ? t.text3 : diff >= 0 ? t.good : t.text2, fontWeight: "600" }]}>
                  {diff === null ? "–" : diff >= 0 ? `▲ ${money(diff)} ahead` : `${money(-diff)} behind`}
                </Text>
              </View>
            );
          })}
          {latestBehind ? (
            <View style={[styles.hint, { backgroundColor: t.accentSoft }]}>
              <Text style={[type.caption, { color: t.text, flex: 1 }]}>
                <Text style={{ fontWeight: "700" }}>A bit behind last month's plan. That's normal.</Text> Markets swing and life happens. Your plan already
                adjusts from your real balances{d.emergencyMonths < (state.plan.efMonths || 3) ? ", starting by refilling your emergency fund" : ""}. Keep checking in.
              </Text>
            </View>
          ) : null}
          <Text style={[type.caption, { color: t.text3 }]}>
            "vs. plan" compares what you have invested with what last month's projection expected. "Spending" compares what you told us you spent with your budget.
          </Text>
        </>
      ) : (
        <Text style={[type.body, { color: t.text3 }]}>No check-ins yet. Log one each month to track actual vs. plan.</Text>
      )}
    </Card>
  );

  /* ---------- badges ---------- */
  const cols = statColumns === 4 ? (twoColumn ? 6 : 4) : 2;
  const rows: (typeof badges)[] = [];
  for (let i = 0; i < badges.length; i += cols) rows.push(badges.slice(i, i + cols));
  const badgeGrid = (
    <Card style={{ gap: space.md }}>
      <View style={styles.between}>
        <SectionLabel>Badges</SectionLabel>
        <Text style={[type.caption, { color: t.text3 }]}>Locked badges show when your plan unlocks them</Text>
      </View>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: space.sm }}>
          {row.map((bd) => (
            <View
              key={bd.key}
              accessible
              accessibilityLabel={`${bd.title}: ${bd.desc}. ${bd.got ? "Unlocked" : bd.eta !== null ? `Locked, plan unlocks ${monthLabel(start, bd.eta)}` : "Locked"}`}
              style={[
                styles.badge,
                { borderColor: bd.got ? t.good : t.border, backgroundColor: bd.got ? t.surface : t.surface2, borderStyle: bd.got ? "solid" : "dashed" },
              ]}
            >
              <Text style={{ fontSize: 22, opacity: bd.got ? 1 : 0.45 }}>{bd.icon}</Text>
              <Text style={[type.label, { color: t.text, fontWeight: "600" }]} numberOfLines={1}>{bd.title}</Text>
              <Text style={[type.caption, { color: t.text3 }]} numberOfLines={2}>{bd.desc}</Text>
              <Text style={[type.caption, { color: bd.got ? t.good : t.text3, fontWeight: "600" }]}>
                {bd.got ? "✓ Unlocked" : bd.eta !== null ? `🔒 ${bd.eta === 0 ? "This month" : monthLabel(start, bd.eta)}` : "🔒 Locked"}
              </Text>
            </View>
          ))}
          {Array.from({ length: cols - row.length }, (_, k) => <View key={`f${k}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </Card>
  );

  return (
    <Screen title="Progress" subtitle="Track it, and keep the streak">
      <View style={{ flexDirection: statColumns === 4 ? "row" : "column", gap: space.lg }}>
        {freedom}
        {streakCard}
        {level}
      </View>
      {projection}
      {whatIfs}
      <View style={{ flexDirection: twoColumn ? "row" : "column", gap: space.lg, alignItems: "flex-start" }}>
        <View style={{ flex: 1, alignSelf: "stretch" }}>{checkin}</View>
        <View style={{ flex: 1.3, alignSelf: "stretch" }}>{history}</View>
      </View>
      {badgeGrid}
      <Divider />
    </Screen>
  );
}

function SliderRow({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
      <View style={styles.between}>
        <Text style={[type.label, { color: t.text2 }]}>{label}</Text>
        <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{value}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  months: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  monthDot: { width: 18, height: 18, borderRadius: 4, borderWidth: 1 },
  detail: { borderRadius: radius.md, padding: space.md, minHeight: 44, justifyContent: "center" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, alignItems: "center" },
  sliders: { gap: space.xl },
  ciRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  tr: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  th: { ...type.overline, paddingVertical: 8, paddingHorizontal: 6 },
  td: { ...type.caption, paddingVertical: 8, paddingHorizontal: 6, fontVariant: ["tabular-nums"] },
  c0: { width: 60 },
  cn: { width: 110, textAlign: "right" },
  spentBox: { borderRadius: radius.md, padding: space.md, marginTop: space.xs },
  hint: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md, flexWrap: "wrap" },
  badge: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 3, minWidth: 0 },
});
