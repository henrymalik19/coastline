/**
 * Money → Monthly savings: the one place to say how much goes to each account each month.
 * Paychecks set the 401(k) (and a paycheck HSA); everything else is set here, from what's left after
 * your budget and debt payments. The Plan tab's Forecast only shows the forecast.
 */
import { accountForecasts, setAsideFor, type AccountKey } from "@coastfi/engine";
import { monthKey } from "../lib/store";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { debtLabel } from "../lib/debts";
import { money, monthLabel } from "../lib/format";
import { usePlan } from "../lib/plan";
import { space, type, useTheme } from "../lib/theme";
import { Icon } from "./Icon";
import { ScheduleEditor, scheduleSummary, useSchedule } from "./ScheduleEditor";
import { Card, Divider } from "./ui";

export function SavingsEditor() {
  const t = useTheme();
  const router = useRouter();
  const { state, result, actual, start } = usePlan();
  const row0 = actual.months[0]!;
  const forecasts = accountForecasts(state, result.d, actual, result.d.r);
  const payrollHsa = state.plan.hsaPayroll !== false;
  const jobs = state.incomes.filter((x) => (x.kind ?? "job") === "job");

  const keys: { k: AccountKey; label: string; unit: string; note?: string }[] = [
    { k: "cash", label: "Emergency fund (cash)", unit: "/mo", note: "Cash can go past your emergency fund goal if you plan it." },
    { k: "ira", label: "IRA", unit: "/mo" },
    ...(payrollHsa ? [] : [{ k: "hsa" as AccountKey, label: "HSA", unit: "/mo" }]),
    { k: "taxable", label: "Brokerage", unit: "/mo" },
    ...state.goals.filter((g) => !g.recurring).map((g) => ({ k: ("goal:" + g.id) as AccountKey, label: g.name || "Goal", unit: "/mo" })),
    ...state.debts.filter((x) => x.balance > 0).map((x) => ({ k: ("debt:" + x.id) as AccountKey, label: `Extra on ${debtLabel(x)}`, unit: "extra/mo" })),
  ];

  const fromPay = [
    ...jobs.filter((x) => (x.pretax ?? 0) > 0).map((x) => `401(k): ${x.name || "your job"} ${money(x.pretax!)}/check`),
    ...(payrollHsa ? jobs.filter((x) => (x.hsaPre ?? 0) > 0).map((x) => `HSA: ${x.name || "your job"} ${money(x.hsaPre!)}/check`) : []),
  ];
  const notPlanned = Math.max(0, row0.available - row0.plannedGot);
  const repeating = state.goals.filter((g) => g.recurring).map((g) => ({ g, v: setAsideFor(g, monthKey(start)) }));
  const short = row0.plannedShort > 0.5;

  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        These come out of what's left after your budget and debt payments. You can also set them on each account (Money → Accounts) or goal. An account with no amount gets whatever your plan steps give it. These show as savings on your budget.
      </Text>

      <Card style={{ gap: 4 }}>
        <Text style={[type.overline, { color: t.text3 }]}>{monthLabel(start, 0)}</Text>
        <Line label="Left after bills" value={money(row0.available)} />
        {row0.setAside > 0.5 ? <Text style={[type.caption, { color: t.text3 }]}>after {money(row0.setAside)} set aside for repeating goals (below)</Text> : null}
        <Line label="Your monthly savings" value={row0.plannedAsk > 0.5 ? `− ${money(row0.plannedAsk)}` : "none set yet"} />
        <View style={[styles.rule, { backgroundColor: t.border }]} />
        <Line
          label={short ? "Short this month" : "Left for your plan steps"}
          value={short ? money(-row0.plannedShort) : money(notPlanned)}
          color={short ? t.bad : t.good}
          strong
        />
        {short ? <Text style={[type.caption, { color: t.bad }]}>Your amounts add up to more than is left. Lower one, or start it in a later month.</Text> : null}
      </Card>

      <Card style={{ gap: 6 }}>
        <Text style={[type.overline, { color: t.text3 }]}>From your paychecks</Text>
        <Text style={[type.caption, { color: t.text2 }]}>
          {fromPay.length ? fromPay.join(" · ") : "No 401(k) or HSA from your paychecks yet."}{fromPay.length ? "." : ""} These come out before take-home, so they're set on your job.
        </Text>
        <Pressable role="link" onPress={() => router.push("/money/income")} hitSlop={6} style={styles.link}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Change on your job (Income)</Text>
          <Icon name="chevron" size={12} color={t.accent} />
        </Pressable>
      </Card>

      <Card padded={false}>
        {keys.map((x, i) => {
          const f = forecasts.find((a) => a.key === x.k);
          return (
            <View key={x.k}>
              <AccountRow k={x.k} label={x.label} unit={x.unit} note={x.note} thisMonth={f ? (x.k.startsWith("debt:") ? f.months[0]!.plan : f.months[0]!.total) : 0} />
              {i < keys.length - 1 ? <Divider /> : null}
            </View>
          );
        })}
      </Card>
      {repeating.length ? (
        <Card style={{ gap: 6 }}>
          <Text style={[type.overline, { color: t.text3 }]}>Repeating goals (set aside by themselves)</Text>
          {repeating.map(({ g, v }) => (
            <Line key={g.id} label={g.name || "Goal"} value={v > 0.5 ? `${money(v)}/mo` : "nothing this month"} />
          ))}
          <Text style={[type.caption, { color: t.text3 }]}>
            These divide what's due by the months until it's due, so the money is ready in time. Change them under Savings goals.
          </Text>
          <Pressable role="link" onPress={() => router.push("/money/goals")} hitSlop={6} style={styles.link}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Savings goals</Text>
            <Icon name="chevron" size={12} color={t.accent} />
          </Pressable>
        </Card>
      ) : null}
      <Pressable role="link" onPress={() => router.push("/plan")} hitSlop={6} style={styles.link}>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>See the forecast month by month (Plan → Forecast)</Text>
        <Icon name="chevron" size={12} color={t.accent} />
      </Pressable>
    </>
  );
}

function AccountRow({ k, label, unit, note, thisMonth }: { k: string; label: string; unit: string; note?: string; thisMonth: number }) {
  const t = useTheme();
  const { list, oneOffs } = useSchedule(k);
  const set = list.length > 0 || Object.keys(oneOffs).length > 0;
  const [open, setOpen] = useState(false);
  return (
    <View style={{ padding: space.md, gap: space.sm }}>
      <Pressable role="button" aria-expanded={open} accessibilityLabel={`${label}: change its monthly amount`} onPress={() => setOpen((v) => !v)} style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.body, { color: t.text, fontWeight: "600" }]}>{label}</Text>
          <Text style={[type.caption, { color: set ? t.accent : t.text3 }]}>
            {set ? (list.length ? scheduleSummary(list).replace("Your plan: ", "") : "One-month changes only") : "No amount set: gets what your steps give it"}
            {Object.keys(oneOffs).length ? ` · ${Object.keys(oneOffs).length} one-month change${Object.keys(oneOffs).length === 1 ? "" : "s"}` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(thisMonth)}</Text>
          <Text style={[type.caption, { color: t.text3 }]}>this month</Text>
        </View>
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <Icon name="chevron" size={14} color={t.text3} />
        </View>
      </Pressable>
      {open ? <ScheduleEditor k={k} label={label} unit={unit} note={note} /> : null}
    </View>
  );
}

function Line({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.line}>
      <Text style={[type.caption, { color: strong ? t.text : t.text2, fontWeight: strong ? "700" : "400", flex: 1 }]}>{label}</Text>
      <Text style={[strong ? type.label : type.caption, { color: color ?? t.text, fontWeight: strong ? "700" : "500", fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  link: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
