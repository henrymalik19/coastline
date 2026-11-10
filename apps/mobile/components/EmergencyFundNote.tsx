import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money, monthLabel } from "../lib/format";
import { HELP } from "../lib/help";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { FieldRow, NumberInput } from "./form";
import { Icon } from "./Icon";
import { MonthlyAmount } from "./ScheduleEditor";
import { Card, Divider, Pill } from "./ui";
import { ProgressBar } from "./ProgressRing";

/** Goals pages: the emergency fund is already a plan step, so it shouldn't be added as a goal. */
export function EmergencyFundNote({ linkToSettings = true }: { linkToSettings?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const { state, result } = usePlan();
  const full = result.plan.fullTarget;
  const cash = result.d.bal.cash;
  return (
    <View style={[styles.box, { backgroundColor: t.accentSoft }]}>
      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
        <Icon name="shield" size={20} color={t.accent} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Your emergency fund is already part of your plan</Text>
          <Text style={[type.caption, { color: t.text2 }]}>
            No need to add it as a goal. The plan builds a starter cushion of <Text style={{ fontWeight: "700", color: t.text }}>{money(state.plan.starterEF)}</Text> first,
            then grows it to <Text style={{ fontWeight: "700", color: t.text }}>{state.plan.efMonths} months of expenses ({money(full)})</Text>, kept in your cash accounts.
          </Text>
        </View>
      </View>
      {full > 0 ? (
        <View style={{ gap: 4 }}>
          <ProgressBar progress={cash / full} color={t.good} />
          <Text style={[type.caption, { color: t.text3 }]}>{money(cash)} of {money(full)} in cash today</Text>
        </View>
      ) : null}
      {linkToSettings ? (
        <Pressable role="link" onPress={() => router.push("/money/goals")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Change emergency fund size →</Text>
        </Pressable>
      ) : (
        <Text style={[type.caption, { color: t.text3 }]}>You can change its size later under Money → Savings goals.</Text>
      )}
    </View>
  );
}

/** Inline nudge when a goal's name looks like an emergency fund. */
export function looksLikeEmergencyFund(name: string) {
  return /emergenc|rainy.?day|safety net/i.test(name);
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  list: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, gap: 4 },
});

/**
 * The emergency fund as a built-in savings goal: its size (months of expenses, and the starter
 * cushion), what's saved (your cash accounts), when it's done, and your monthly plan for it. Not a
 * regular goal underneath: its target follows your spending and it holds your actual cash.
 */
export function EmergencyFundGoal() {
  const t = useTheme();
  const router = useRouter();
  const { state, result, actual, start } = usePlan();
  const update = useStore((s) => s.update);
  const [planOpen, setPlanOpen] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const full = actual.fullTarget;
  const cash = result.d.bal.cash;
  const monthly = result.d.monthlyExpenses;
  const done = actual.events.find((e) => e.key === "fullEF");
  const cashAccounts = state.accounts.filter((a) => a.type === "cash");
  const schedule = state.plan.schedule?.cash;
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name="shield" size={20} color={t.accent} />
        <Text style={[type.heading, { color: t.text, flex: 1 }]}>Emergency fund</Text>
        <Pill tone="accent">Built in</Pill>
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>
        Kept in your cash accounts. Your plan builds the starter cushion first, then the full fund. Its size follows your spending.
      </Text>
      <FieldRow label="Full fund" hint={`${state.plan.efMonths} months of expenses (${money(monthly)}/mo) = ${money(full)}. 0 for none.`} info={HELP.efMonths}>
        <NumberInput kind="decimal" label="Full emergency fund in months" value={state.plan.efMonths} max={24} step={1} onChange={(v) => update((p) => { p.plan.efMonths = v; })} />
      </FieldRow>
      <Divider />
      <FieldRow label="Starter cushion" hint="Built first, before paying down high-interest debt" info={HELP.starterEF}>
        <NumberInput kind="money" label="Starter emergency fund" value={state.plan.starterEF} onChange={(v) => update((p) => { p.plan.starterEF = v; })} />
      </FieldRow>
      <Divider />
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.label, { color: t.text, flex: 1 }]}>Saved</Text>
          <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(cash)} of {money(full)}</Text>
        </View>
        {full > 0 ? <ProgressBar progress={cash / full} color={t.good} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
          {full > 0 ? (
            <Text style={[type.caption, { color: cash >= full - 0.5 ? t.good : t.text3, fontWeight: "600" }]}>
              {cash >= full - 0.5 ? "Fully funded" : done ? `Fully funded ${done.m === 0 ? "this month" : monthLabel(start, done.m)}` : "Not reached in the plan"}
            </Text>
          ) : null}
          {cashAccounts.length ? (
            <Pressable
              role="button"
              aria-expanded={showAccounts}
              accessibilityLabel={`${cashAccounts.length} cash accounts, ${showAccounts ? "hide" : "show"}`}
              onPress={() => setShowAccounts((v) => !v)}
              hitSlop={6}
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Text style={[type.caption, { color: t.text3 }]}>
                {full > 0 ? "· " : ""}In {cashAccounts.length} cash account{cashAccounts.length === 1 ? "" : "s"}
              </Text>
              <View style={{ transform: [{ rotate: showAccounts ? "90deg" : "0deg" }] }}>
                <Icon name="chevron" size={12} color={t.text3} />
              </View>
            </Pressable>
          ) : (
            <Text style={[type.caption, { color: t.text3 }]}>{full > 0 ? "· " : ""}No cash accounts yet</Text>
          )}
        </View>
        {showAccounts ? (
          <View style={[styles.list, { backgroundColor: t.surface2 }]}>
            {cashAccounts.map((a) => (
              <View key={a.id} style={{ flexDirection: "row", gap: space.sm }}>
                <Text numberOfLines={1} style={[type.caption, { color: t.text2, flex: 1 }]}>{a.name.trim() || "Cash"}</Text>
                <Text style={[type.caption, { color: t.text2, fontVariant: ["tabular-nums"] }]}>{money(a.balance)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Pressable role="link" onPress={() => router.push("/money/accounts?from=goals")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Update cash balances →</Text>
        </Pressable>
      </View>
      <Divider />
      {cashAccounts.length ? (
        cashAccounts.map((a) => (
          <View key={a.id} style={{ gap: 2 }}>
            {cashAccounts.length > 1 ? <Text style={[type.caption, { color: t.text2, fontWeight: "600" }]}>{a.name.trim() || "Cash"}</Text> : null}
            <MonthlyAmount k={"acct:" + a.id} label={a.name.trim() || "Cash"} note="Cash can go past your goal if you plan it." />
          </View>
        ))
      ) : null}
      {!cashAccounts.length || (state.plan.schedule?.cash?.length ?? 0) > 0 || Object.keys(state.plan.scheduleMonths?.cash ?? {}).length > 0 ? (
        <MonthlyAmount k="cash" label={cashAccounts.length ? "Emergency fund (all cash)" : "Emergency fund"} note="Cash can go past your goal if you plan it." />
      ) : null}
    </Card>
  );
}
