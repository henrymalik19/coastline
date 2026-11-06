import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import { ProgressRing } from "../../components/ProgressRing";
import { Card, Divider, Pill, Screen, SectionLabel, Stat, type Tone } from "../../components/ui";
import { ageLabel, money, monthLabel, percent } from "../../lib/format";
import { monthTodos, usePlan, type Todo } from "../../lib/plan";
import { radius, space, type, useTheme } from "../../lib/theme";

const oddsTone = (p: number): Tone => (p >= 0.8 ? "good" : p >= 0.6 ? "warn" : "bad");

export default function Home() {
  const t = useTheme();
  const { state, result: o, start, isSample } = usePlan();
  const d = o.d;
  const m0 = o.plan.months[0]!;
  const todos = monthTodos(m0, t, state.plan.marginalTax);

  const coastAge = o.crossing === null ? null : d.age + o.crossing;
  const coastAgeCons = o.crossingC === null ? null : d.age + o.crossingC;

  return (
    <Screen
      title="Coast FI"
      subtitle={monthLabel(start, 0, true)}
      right={isSample ? <Pill tone="accent">Sample plan</Pill> : undefined}
    >
      {/* Hero: progress to Coast FI */}
      <Card>
        <View style={styles.heroRow}>
          <ProgressRing progress={o.progress} label={`${percent(o.progress)} of the way to Coast FI`}>
            <Text style={[type.title, { color: t.text, fontVariant: ["tabular-nums"] }]}>{percent(Math.min(o.progress, 9.99))}</Text>
            <Text style={[type.caption, { color: t.text3 }]}>to Coast FI</Text>
          </ProgressRing>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={[type.label, { color: t.text3 }]}>You can stop investing at</Text>
            <Text style={[type.display, { color: t.text, fontSize: 30, lineHeight: 36 }]}>
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
          <View style={styles.between}>
            <Text style={[type.label, { color: t.text2 }]}>Invested today</Text>
            <Text style={[type.label, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(d.invested)}</Text>
          </View>
          <View style={styles.between}>
            <Text style={[type.label, { color: t.text2 }]}>Coast number today</Text>
            <Text style={[type.label, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(o.coastNow)}</Text>
          </View>
        </View>
      </Card>

      {/* Key numbers */}
      <View style={styles.grid}>
        <Card style={styles.cell}>
          <Stat label="FIRE number" value={money(o.fire, { compact: true })} hint={`${money(d.retireAnnual, { compact: true })}/yr at ${percent(d.swr, 1)}`} />
        </Card>
        <Card style={styles.cell}>
          <Stat label={`Odds of FIRE by ${d.retireAge}`} value={percent(o.mc.probFire)} tone={oddsTone(o.mc.probFire)} hint="Across 2,000 market paths" />
        </Card>
        <Card style={styles.cell}>
          <Stat label="Freedom bought" value={`${Math.round(o.freedomDays).toLocaleString("en-US")} days`} hint="Of retirement spending, today" />
        </Card>
        <Card style={styles.cell}>
          <Stat
            label="+$100/month"
            value={o.coastSoonerMonths ? `${o.coastSoonerMonths} mo sooner` : "—"}
            hint="Effect on your coast date"
          />
        </Card>
      </View>

      {/* This month's to-dos */}
      <Card padded={false}>
        <View style={[styles.between, { padding: space.lg, paddingBottom: space.md }]}>
          <View>
            <SectionLabel>This month</SectionLabel>
            <Text style={[type.heading, { color: t.text, marginTop: -4 }]}>{todos.length ? `${todos.length} things to do` : "Nothing extra this month"}</Text>
          </View>
          {m0.extraCheck ? <Pill tone="good">Extra paycheck</Pill> : null}
        </View>
        <Divider />
        {todos.map((td, i) => (
          <View key={td.key}>
            <TodoRow todo={td} />
            {i < todos.length - 1 ? <View style={{ marginLeft: 60 }}><Divider /></View> : null}
          </View>
        ))}
        {m0.shortfall > 0.5 ? (
          <Text style={[type.caption, { color: t.bad, padding: space.lg }]}>Short {money(m0.shortfall)} this month, covered from cash.</Text>
        ) : null}
      </Card>

      {/* Assumptions, always visible */}
      <View style={styles.footer}>
        <Icon name="info" size={16} color={t.text3} />
        <Text style={[type.caption, { color: t.text3, flex: 1 }]}>
          Today's dollars. {percent(d.r, 1)} real return after fees, {percent(d.vol)} volatility, {percent(d.swr, 1)} withdrawal rate. For planning and education, not financial advice.
        </Text>
      </View>
    </Screen>
  );
}

function TodoRow({ todo }: { todo: Todo }) {
  const t = useTheme();
  const [done, setDone] = useState(false);
  return (
    <Pressable
      onPress={() => setDone((v) => !v)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={`${todo.title}${todo.amount ? `, ${money(todo.amount)}` : ""}`}
      style={({ pressed }) => [styles.todo, { backgroundColor: pressed ? t.surface2 : "transparent" }]}
    >
      <View
        style={[
          styles.check,
          { borderColor: done ? t.good : t.border, backgroundColor: done ? t.good : "transparent" },
        ]}
      >
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
  heroRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  note: { marginTop: space.lg, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  cell: { flexGrow: 1, flexBasis: "45%", minWidth: 150 },
  todo: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  amount: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footer: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.xs, alignItems: "flex-start" },
});
