import { budgetView, isHighInterest, paysExtra } from "@coastfi/engine";
import { spanText } from "../../lib/homeLoan";
import { budgetKeyFor } from "../../lib/budgetLinks";
import { useCategories } from "../../lib/categories";
import { cardMap, liveBudget } from "../../lib/register";
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
import { spouseIraLabel } from "../../lib/spouse";
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
  const todos = monthTodos(m0, t, state.plan.marginalTax, d.rothShare, state.plan.hsaPayroll, spouseIraLabel(state).replace(/^Your/, "your"));
  const mk = monthKey(start);
  // once the budget is started, this month's to-dos follow what's assigned there
  const budgeting = !!state.budgetPlan && mk >= state.budgetPlan.start;
  const cats = useCategories(mk);
  const txns = useStore((s) => s.txns);
  const bview = budgeting ? budgetView(liveBudget(state), cats, mk, { txns, cards: cardMap(state) }) : null;
  const rta = bview?.readyToAssign ?? 0;
  const assignedNow = state.budgetPlan?.months?.[mk]?.assigned ?? {};
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
    return i < 0 ? undefined : `Priority ${i + 1}`;
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
        {o.mortgagesAtRetire.length ? (
          <Pressable role="link" onPress={() => router.push("/money/debts")} style={[styles.homeNote, { backgroundColor: t.warnSoft }]}>
            <Text style={[type.caption, { color: t.text2, flex: 1 }]}>
              {o.mortgagesAtRetire.length === 1
                ? `Your mortgage runs ${o.mortgagesAtRetire[0]!.months !== null ? spanText(o.mortgagesAtRetire[0]!.months!) + " " : ""}into retirement`
                : `${o.mortgagesAtRetire.length} mortgages run into retirement`}
              , which adds about {money(o.homeBridge, { whole: true })} to your number. <Text style={{ color: t.accent, fontWeight: "700" }}>See it on Debts</Text>
            </Text>
          </Pressable>
        ) : null}
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
      info={`What you'll want invested when you retire: your yearly retirement spending (${money(d.retireAnnual, { whole: true })}${d.retireIncomeAnnual > 0 ? ", minus Social Security or pensions" : ""}) divided by a ${percent(d.swr, 1)} withdrawal rate, with a little extra for taxes on pre-tax money${o.homeBridge > 0.5 ? `, plus ${money(o.homeBridge, { whole: true })} for mortgage payments left after you retire` : ""}. Withdrawing ${percent(d.swr, 1)} a year is meant to last for life.`}
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
      {budgeting ? (
        <Pressable role="link" onPress={() => router.push("/budget")} style={[styles.rtaRow, { backgroundColor: rta < -0.5 ? t.badSoft : rta > 0.5 ? t.goodSoft : t.surface2 }]}>
          <Text style={[type.label, { color: t.text, flex: 1 }]}>Ready to assign</Text>
          <Text style={[type.label, { color: rta < -0.5 ? t.bad : rta > 0.5 ? t.good : t.text2, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(rta)}</Text>
          <Icon name="chevron" size={14} color={t.text3} />
        </Pressable>
      ) : null}
      {todos.map((td, i) => {
        // with a budget, a to-do is done when its line has the money: tap to open that line
        const bk = budgeting ? budgetKeyFor(state, td.key, mk) : null;
        // a debt's line holds the minimum too; the to-do is the extra
        const minimum = bk?.startsWith("debt:") ? state.debts.find((x) => "debt:" + x.id === bk)?.minPayment ?? 0 : 0;
        const got = bk ? Math.max(0, (assignedNow[bk] ?? 0) - minimum) : 0;
        return (
          <View key={td.key}>
            {bk ? (
              <TodoRow
                todo={{ ...td, detail: [`${money(got)} of ${money(td.amount ?? 0)} assigned on Budget`, stepOf(td.key)].filter(Boolean).join(" · ") }}
                done={got >= (td.amount ?? 0) - 0.5}
                link
                onToggle={() => router.push(`/budget?focus=${encodeURIComponent(bk)}`)}
              />
            ) : (
              <TodoRow todo={{ ...td, detail: [td.detail, stepOf(td.key)].filter(Boolean).join(" · ") }} done={done.includes(td.key)} onToggle={() => toggleTodo(mk, td.key)} />
            )}
            {i < todos.length - 1 ? <View style={{ marginLeft: 56 }}><Divider /></View> : null}
          </View>
        );
      })}
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

function TodoRow({ todo, done, onToggle, link }: { todo: Todo; done: boolean; onToggle: () => void; /** Opens its Budget line instead of ticking. */ link?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      role={link ? "link" : "checkbox"}
      aria-checked={link ? undefined : done}
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
      {link ? <Icon name="chevron" size={14} color={t.text3} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  homeNote: { borderRadius: 8, padding: 10, flexDirection: "row" },
  heroRow: { flexDirection: "row", alignItems: "center", gap: space.xl },
  note: { marginTop: space.lg, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  statRow: { flexDirection: "row", gap: space.lg, alignItems: "stretch" },
  wideRow: { flexDirection: "row", gap: space.lg, alignItems: "stretch" },
  todo: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  amount: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rtaRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.lg, marginBottom: space.sm, paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.md },
  footer: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.xs, alignItems: "flex-start" },
  banner: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, flexWrap: "wrap" },
});
