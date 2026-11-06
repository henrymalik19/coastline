import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/form";
import { Icon } from "../../components/Icon";
import { ProgressRing } from "../../components/ProgressRing";
import { Card, Divider, Pill, Screen, SectionLabel, Stat, type Tone } from "../../components/ui";
import { ageLabel, money, monthLabel, percent } from "../../lib/format";
import { useLayout } from "../../lib/layout";
import { monthTodos, usePlan, type Todo } from "../../lib/plan";
import { monthKey, useStore } from "../../lib/store";
import { radius, space, type, useTheme } from "../../lib/theme";

const oddsTone = (p: number): Tone => (p >= 0.8 ? "good" : p >= 0.6 ? "warn" : "bad");

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  // `wide` = room for two cards side by side; stats go 4 or 2 per row
  const { twoColumn: wide, statColumns } = useLayout();
  const { state, result: o, start } = usePlan();
  const d = o.d;
  const m0 = o.plan.months[0]!;
  const todos = monthTodos(m0, t, state.plan.marginalTax);
  const mk = monthKey(start);
  const done = useStore((s) => s.todoDone[mk]) ?? [];
  const toggleTodo = useStore((s) => s.toggleTodo);

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
        <Row label="Invested today" value={money(d.invested)} />
        <Row label="Coast number today" value={money(o.coastNow)} />
      </View>
    </Card>
  );

  const statCards = [
    <Stat key="fire" label="FIRE number" value={money(o.fire, { compact: true })} hint={`${money(d.retireAnnual, { compact: true })}/yr at ${percent(d.swr, 1)}`} />,
    <Stat key="odds" label={`Odds of FIRE by ${d.retireAge}`} value={percent(o.mc.probFire)} tone={oddsTone(o.mc.probFire)} hint="Across 2,000 market paths" />,
    <Stat key="days" label="Freedom bought" value={`${Math.round(o.freedomDays).toLocaleString("en-US")} days`} hint="Of retirement spending, today" />,
    <Stat key="100" label="+$100/month" value={o.coastSoonerMonths ? `${o.coastSoonerMonths} mo sooner` : "—"} hint="Effect on your coast date" />,
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
      <Divider />
      {todos.map((td, i) => (
        <View key={td.key}>
          <TodoRow todo={td} done={done.includes(td.key)} onToggle={() => toggleTodo(mk, td.key)} />
          {i < todos.length - 1 ? <View style={{ marginLeft: 56 }}><Divider /></View> : null}
        </View>
      ))}
      {m0.shortfall > 0.5 ? (
        <Text style={[type.caption, { color: t.bad, padding: space.lg }]}>Short {money(m0.shortfall)} this month, covered from cash.</Text>
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
    <Screen title="Coast FI" subtitle={monthLabel(start, 0, true)}>
      {wide ? (
        <>
          {stats}
          <View style={styles.wideRow}>
            {hero}
            {thisMonth}
          </View>
        </>
      ) : (
        <>
          {hero}
          {stats}
          {thisMonth}
        </>
      )}
      {footer}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.between}>
      <Text style={[type.label, { color: t.text2 }]}>{label}</Text>
      <Text style={[type.label, { color: t.text, fontVariant: ["tabular-nums"] }]}>{value}</Text>
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
