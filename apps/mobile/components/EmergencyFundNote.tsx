import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { radius, space, type, useTheme } from "../lib/theme";
import { Icon } from "./Icon";
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
        <Pressable role="link" onPress={() => router.push("/settings/assumptions")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Change emergency fund size →</Text>
        </Pressable>
      ) : (
        <Text style={[type.caption, { color: t.text3 }]}>You can change its size later in Settings → Assumptions & plan rules.</Text>
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
});
