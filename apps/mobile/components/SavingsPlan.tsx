/**
 * Your monthly saving plan under the budget: what each account gets each month (the amounts you set under
 * Money → Monthly savings), and what's left for the rest of your steps. Not a budget cost: it comes out
 * of what's left over, so it never counts twice.
 */
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { plannedSavings } from "../lib/steps";
import { space, type, useTheme } from "../lib/theme";

export function SavingsPlan({ leftover }: { leftover: number }) {
  const t = useTheme();
  const router = useRouter();
  const { state, start } = usePlan();
  const items = plannedSavings(state, `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`).filter((x) => x.amount > 0.5);
  if (!items.length)
    return (
      <Pressable role="link" onPress={() => router.push("/budget")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Set how much goes to savings each month ›</Text>
      </Pressable>
    );
  const total = items.reduce((a, x) => a + x.amount, 0);
  const rest = leftover - total;
  return (
    <View style={{ gap: 2 }}>
      <Text style={[type.overline, { color: t.text3, marginTop: space.xs }]}>Savings (your monthly plan)</Text>
      {items.map((x) => (
        <View key={x.key} style={styles.line}>
          <Text style={[type.caption, { color: t.text2, flex: 1 }]}>{x.label}</Text>
          <Text style={[type.caption, { color: t.text, fontVariant: ["tabular-nums"] }]}>− {money(x.amount)}</Text>
        </View>
      ))}
      <View style={[styles.line, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, paddingTop: 4, marginTop: 2 }]}>
        <Text style={[type.caption, { color: t.text, fontWeight: "700", flex: 1 }]}>{rest < 0 ? "Short of your saving plan" : "Left for your other steps"}</Text>
        <Text style={[type.label, { color: rest < 0 ? t.bad : t.good, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(rest)}</Text>
      </View>
      <Pressable role="button" onPress={() => router.push("/budget")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Change it on the Budget tab ›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 1 },
});
