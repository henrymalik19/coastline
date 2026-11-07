import { isHighInterest, paysExtra } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { longMonth } from "../../components/AdjustmentsCard";
import { Button, InfoText, InfoTip } from "../../components/form";
import { Icon } from "../../components/Icon";
import { ProgressRing } from "../../components/ProgressRing";
import { Card, Divider, Pill, Screen, SectionLabel, Stat, type Tone } from "../../components/ui";
import { ageLabel, money, monthLabel, percent } from "../../lib/format";
import { useLayout } from "../../lib/layout";
import { monthTodos, shortfallText, usePlan, type Todo } from "../../lib/plan";
import { NetWorthCard } from "../../components/MoneyCards";
import { monthKey, useStore } from "../../lib/store";
import { radius, space, type, useTheme } from "../../lib/theme";

const oddsTone = (p: number): Tone => (p >= 0.8 ? "good" : p >= 0.6 ? "warn" : "bad");

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  // `wide` = room for two cards side by side; stats go 4 or 2 per row
  const { twoColumn: wide, statColumns } = useLayout();
  const { state, result: o, start, actual, whatIfOn } = usePlan();
  const d = o.d;
  // this month's to-dos come from the real plan (no what-ifs)
  const m0 = actual.months[0]!;
  const todos = monthTodos(m0, t, state.plan.marginalTax, d.rothShare, state.plan.hsaPayroll);
  const mk = monthKey(start);
  const done = useStore((s) => s.todoDone[mk]) ?? [];
  const toggleTodo = useStore((s) => s.toggleTodo);

  // which plan step a to-do comes from ("Step 3: Pay off high-interest debt")
  const stepOf = (key: string): string | undefined => {
    const steps = state.plan.steps;
    const match = (k: string) => {
      // the step that's actually running: the starter fund until it's full, high-interest debt while there is any
      if (key === "ef") return k === (d.bal.cash >= actual.starterTarget - 0.5 ? "fullEF" : "starterEF");
      if (key === "debt") {
        const high = state.debts.some((x) => x.balance > 0 && paysExtra(x) && isHighInterest(x, state.plan.highApr));
        return k === (high ? "highDebt" : "lowDebt");
      }
      if (key === "goals") return k.startsWith("goal:");
      return k === key;
    };
    const i = steps.findIndex(match);
    return i < 0 ? undefined : `Plan step ${i + 1}`;
  };

  const coastAge = o.crossing === null ? null : d.age + o.crossing;
  const coastAgeCons = o.crossingC === null ? null : d.age + o.crossingC;

  /* ---------- pieces ---------- */
  const hero = (
    <Card style={wide ? { flex: 3 } : undefined}>
      <View style={styles.heroRow}>
        <ProgressRing progress={o.progress} size={wide ? 168 : 132} stroke={wide ? 14 : 12} label={`${percent(o.progress)} of the way to Coast FI`}>
          <Text style={[type.title, { color: t.text, fontVariant: ["tabular-nums"] }]}>{percent(Math.min(o.progress, 9.99))}</Text>
          <Text style={[type.caption, { color: t.text3 }]}>to Coast FI</Text>
        </ProgressRing>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text style={[type.label, { color: t.text3 }]}>You can stop investing at</Text>
          <Text style={[type.display, { color: t.text, fontSize: wide ? 40 : 30, lineHeight: wide ? 46 : 36 }]}>
            {coastAge === null ? "Not yet" : o.crossing === 0 ? "Now" : `Age ${Math.floor(coastAge)}`}
          </Text>
          <Text style={[type.caption, { color: t.text3 }]}>
            {coastAge !== null && o.crossing! > 0 ? `${ageLabel(coastAge)} · ${monthLabel(start, Math.round(o.crossing! * 12))}` : "Not before your retirement age"}
          </Text>
        </View>
      </View>
      <View style={[styles.note, { backgroundColor: t.surface2 }]}>
        <Text style={[type.caption, { color: t.text2, flex: 1 }]}>
          If returns are 1.5 pts lower:{" "}
          <Text style={{ fontWeight: "600", color: t.text }}>
            {coastAgeCons === null ? "not before retirement" : `age ${Math.floor(coastAgeCons)}`}
          </Text>
        </Text>
      </View>
      <View style={{ marginTop: space.lg, gap: space.sm }}>
        <Row
          label="Invested today"
          value={money(d.invested)}
          info="Your 401(k), IRA, HSA and brokerage balances added up. Cash (your emergency fund) and property aren't counted: this is the money that grows for retirement."
        />
        <Row
          label="Coast number today"
          value={money(o.coastNow, { whole: true })}
          info={`What you'd need invested today for growth alone to reach your FIRE number (${money(o.fire, { whole: true })}) by age ${d.retireAge}, at ${percent(d.r, 1)} a year after inflation. It goes up a little every year you wait. You have ${money(d.invested)} of it (${percent(Math.min(o.progress, 9.99))}).`}
        />
        <Row
          label="Cash cushion"
          info="How many months of your monthly costs (budget, debt payments and set-asides) your cash would cover if your income stopped. Three to six months is a common target."
          value={Number.isFinite(d.emergencyMonths) ? `${d.emergencyMonths.toFixed(1)} months of expenses` : "No monthly expenses set"}
          tone={Number.isFinite(d.emergencyMonths) && d.emergencyMonths < 3 ? t.warn : undefined}
        />
        <Pressable role="link" onPress={() => router.push("/progress")} hitSlop={6} style={{ alignSelf: "flex-end" }}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>What if I save more, or returns change? Try it →</Text>
        </Pressable>
        {!state.emergency?.active ? (
          <Pressable role="link" onPress={() => router.push("/emergency")} hitSlop={6} style={{ alignSelf: "flex-end" }}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Money emergency? Pause the plan →</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );

  const statCards = [
    <Stat
      key="fire"
      label="FIRE number"
      value={money(o.fire, { whole: true })}
      hint={`${money(d.retireAnnual, { whole: true })}/yr at ${percent(d.swr, 1)}`}
      info={`What you'll want invested when you retire: your yearly retirement spending (${money(d.retireAnnual, { whole: true })}${d.retireIncomeAnnual > 0 ? ", minus Social Security or pensions" : ""}) divided by a ${percent(d.swr, 1)} withdrawal rate, with a little extra for taxes on pre-tax money. Withdrawing ${percent(d.swr, 1)} a year is meant to last for life.`}
    />,
    <Stat
      key="odds"
      label={`Odds of FIRE by ${d.retireAge}`}
      value={percent(o.mc.probFire)}
      tone={oddsTone(o.mc.probFire)}
      hint="Across 2,000 market paths"
      info={`Markets don't grow in a straight line. We simulate 2,000 possible futures with ups and downs (${percent(d.vol)} volatility) and count how many reach your FIRE number by age ${d.retireAge} if you follow the plan.`}
    />,
    <Stat
      key="days"
      label="Freedom bought"
      value={`${Math.round(o.freedomDays).toLocaleString("en-US")} days`}
      hint="Of retirement spending, today"
      info="What you've invested divided by one day of retirement spending: how many days of not working you've already paid for."
    />,
  ];
  const statRows: (typeof statCards)[] = [];
  for (let i = 0; i < statCards.length; i += statColumns) statRows.push(statCards.slice(i, i + statColumns));
  const stats = (
    <View style={{ gap: space.lg }}>
      {statRows.map((row, r) => (
        <View key={r} style={styles.statRow}>
          {row.map((s) => (
            <Card key={s.key} style={{ flex: 1 }}>{s}</Card>
          ))}
        </View>
      ))}
    </View>
  );

  const thisMonth = (
    <Card padded={false} style={wide ? { flex: 2 } : undefined}>
      <View style={[styles.between, { padding: space.lg, paddingBottom: space.md }]}>
        <View>
          <SectionLabel>This month</SectionLabel>
          <Text style={[type.heading, { color: t.text, marginTop: -4 }]}>{todos.length ? `${todos.length} things to do` : "Nothing extra this month"}</Text>
        </View>
        {m0.extraCheck ? <Pill tone="good">Extra paycheck</Pill> : null}
      </View>
      {todos.length && !m0.emergency ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, marginTop: -space.xs, gap: 4 }}>
          <Text style={[type.caption, { color: t.text2, fontVariant: ["tabular-nums"] }]}>
            {money(m0.income)} in − {money(m0.expenses)} costs ={" "}
            <Text style={{ fontWeight: "700", color: t.text }}>{money(Math.max(0, m0.income - m0.expenses))}</Text> for your plan
          </Text>
          {m0.extraCheck ? (
            <Text style={[type.caption, { color: t.text3 }]}>
              This month has an extra paycheck, so there's more than in a normal month (the budget page shows a normal month).
            </Text>
          ) : null}
          {whatIfOn ? (
            <Text style={[type.caption, { color: t.text3 }]}>Your what-ifs (on Progress) change the dates and odds above, not these to-dos.</Text>
          ) : null}
        </View>
      ) : null}
      <Divider />
      {todos.map((td, i) => (
        <View key={td.key}>
          <TodoRow todo={{ ...td, detail: [td.detail, stepOf(td.key)].filter(Boolean).join(" · ") }} done={done.includes(td.key)} onToggle={() => toggleTodo(mk, td.key)} />
          {i < todos.length - 1 ? <View style={{ marginLeft: 56 }}><Divider /></View> : null}
        </View>
      ))}
      {m0.shortfall > 0.5 ? (
        <Text style={[type.caption, { color: t.bad, padding: space.lg }]}>{shortfallText(m0)}</Text>
      ) : null}
    </Card>
  );

  const footer = (
    <View style={styles.footer}>
      <Icon name="info" size={16} color={t.text3} />
      <Text style={[type.caption, { color: t.text3, flex: 1 }]}>
        Today's dollars. {percent(d.r, 1)} real return after fees, {percent(d.vol)} volatility, {percent(d.swr, 1)} withdrawal rate. For planning and education, not financial advice.
      </Text>
    </View>
  );

  /* ---------- layout: dashboard on desktop web, single column on phones ---------- */
  return (
    <Screen title="Coastline" subtitle={monthLabel(start, 0, true)}>
      {state.emergency?.active ? (
        <View style={[styles.banner, { backgroundColor: t.warnSoft }]} role="status">
          <Icon name="shield" size={20} color={t.warn} />
          <View style={{ flex: 1, minWidth: 220 }}>
            <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Emergency mode is on through {longMonth(state.emergency.until)}</Text>
            <Text style={[type.caption, { color: t.text2 }]}>Investing is paused and everything left over stays in cash. Your plan resumes after that.</Text>
          </View>
          <Button title="Manage" onPress={() => router.push("/emergency")} />
        </View>
      ) : null}
      {wide ? (
        <>
          {stats}
          <View style={styles.wideRow}>
            {hero}
            {thisMonth}
          </View>
          <NetWorthCard />
        </>
      ) : (
        <>
          {hero}
          {stats}
          <NetWorthCard />
          {thisMonth}
        </>
      )}
      {footer}
    </Screen>
  );
}

function Row({ label, value, tone, info }: { label: string; value: string; tone?: string; info?: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.between}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
          <Text style={[type.label, { color: t.text2 }]}>{label}</Text>
          {info ? <InfoTip text={info} label={label} open={open} onToggle={setOpen} /> : null}
        </View>
        <Text style={[type.label, { color: tone ?? t.text, fontVariant: ["tabular-nums"], fontWeight: tone ? "700" : undefined }]}>{value}</Text>
      </View>
      {info && open ? <InfoText text={info} /> : null}
    </View>
  );
}

function TodoRow({ todo, done, onToggle }: { todo: Todo; done: boolean; onToggle: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      role="checkbox"
      aria-checked={done}
      accessibilityLabel={`${todo.title}${todo.amount ? `, ${money(todo.amount)}` : ""}`}
      style={({ pressed }) => [styles.todo, { backgroundColor: pressed ? t.surface2 : "transparent" }]}
    >
      <View style={[styles.check, { borderColor: done ? t.good : t.border, backgroundColor: done ? t.good : "transparent" }]}>
        {done ? <Icon name="check" size={16} color="#fff" /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: done ? t.text3 : t.text, fontWeight: "500", textDecorationLine: done ? "line-through" : "none" }]}>
          {todo.title}
        </Text>
        {todo.detail ? <Text style={[type.caption, { color: t.text3 }]}>{todo.detail}</Text> : null}
      </View>
      {todo.amount ? (
        <View style={styles.amount}>
          <View style={[styles.dot, { backgroundColor: todo.color }]} />
          <Text style={[type.label, { color: done ? t.text3 : t.text, fontVariant: ["tabular-nums"], fontWeight: "600" }]}>{money(todo.amount)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: "row", alignItems: "center", gap: space.xl },
  note: { marginTop: space.lg, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  statRow: { flexDirection: "row", gap: space.lg, alignItems: "stretch" },
  wideRow: { flexDirection: "row", gap: space.lg, alignItems: "stretch" },
  todo: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  amount: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footer: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.xs, alignItems: "flex-start" },
  banner: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, flexWrap: "wrap" },
});
