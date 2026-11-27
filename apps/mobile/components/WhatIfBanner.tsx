import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { hasWhatIf, NO_WHATIF, usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button } from "./form";
import { Icon } from "./Icon";

/**
 * Shown on Home and Forecast → Overview while what-ifs are on, so a tried-out change is never taken for
 * the real plan. The numbers they change are orange, like here.
 */
export function WhatIfBanner() {
  const t = useTheme();
  const router = useRouter();
  const { state, whatIfOn } = usePlan();
  const update = useStore((s) => s.update);
  if (!whatIfOn) return null;
  const w = state.whatif;
  const sliders = hasWhatIf(w);
  return (
    <View role="status" style={[styles.box, { backgroundColor: t.warnSoft, borderColor: t.warn }]}>
      <Icon name="sliders" size={18} color={t.warn} />
      <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
        <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>What-ifs are on</Text>
        <Text style={[type.caption, { color: t.text2 }]}>
          The numbers in orange include them, so they aren't your real plan.{sliders ? "" : " A one-month what-if (like a bonus or a big bill) is still on."}
        </Text>
      </View>
      <View style={styles.actions}>
        {sliders ? <Button title="Turn off" tone="primary" onPress={() => update((p) => { p.whatif = NO_WHATIF; })} /> : null}
        <Button title="See them" tone="ghost" onPress={() => router.push("/plan?view=whatif")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, flexWrap: "wrap" },
  actions: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
