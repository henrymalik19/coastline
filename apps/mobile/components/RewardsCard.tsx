import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { InfoText, InfoTip } from "./form";
import { ProgressBar } from "./ProgressRing";
import { Card, SectionLabel } from "./ui";
import { badgeList } from "../lib/badges";
import { monthLabel } from "../lib/format";
import { useStreak } from "../lib/history";
import { usePlan } from "../lib/plan";
import { space, type, useTheme } from "../lib/theme";

/** Home: your streak, your level and the next badge. Tap to see every badge. */
export function RewardsCard({ style }: { style?: ViewStyle }) {
  const t = useTheme();
  const router = useRouter();
  const { state, result: o, start } = usePlan();
  const streak = useStreak();
  const [tip, setTip] = useState(false);
  const badges = badgeList(state, o, streak);
  const got = badges.filter((b) => b.got).length;
  const next = badges.filter((b) => !b.got && b.eta !== null).sort((a, b) => a.eta! - b.eta!)[0];
  const budget = streak.kind === "budget";
  const info = budget
    ? "Months in a row you stayed within your budget: no category ended up overspent. This month counts once it's on track."
    : "Months in a row your balances were kept up to date. Once you budget in the app, this becomes months within budget.";
  return (
    <Card style={{ gap: space.md, ...style }}>
      <View style={styles.between}>
        <View style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <View style={styles.row}>
            <SectionLabel flush>{budget ? "Within budget" : "Streak"}</SectionLabel>
            <InfoTip text={info} label="Streak" open={tip} onToggle={setTip} />
          </View>
          <Text style={[type.heading, { color: t.text }]}>
            {streak.n} {streak.n === 1 ? "month" : "months"} in a row{streak.n >= 3 ? " 🔥" : ""}
          </Text>
        </View>
        <View role="img" aria-label={`${streak.last12.filter((m) => m.done).length} of the last 12 months`} style={styles.dots}>
          {streak.last12.slice(-6).map((m) => (
            <View key={m.key} style={[styles.dot, { backgroundColor: m.done ? t.good : t.surface2, borderColor: m.done ? t.good : t.border }]} />
          ))}
        </View>
      </View>
      {tip ? <InfoText text={info} /> : null}
      <Pressable role="link" accessibilityLabel={`Level ${got + 1}, ${got} of ${badges.length} badges. See all badges`} onPress={() => router.push("/badges")} style={{ gap: 6 }}>
        <View style={styles.between}>
          <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Level {got + 1}</Text>
          <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]}>{got} of {badges.length} badges</Text>
        </View>
        <ProgressBar progress={got / badges.length} />
        <View style={styles.between}>
          <Text style={[type.caption, { color: t.text2, flex: 1, minWidth: 0 }]} numberOfLines={1}>
            {next ? `Next: ${next.icon} ${next.title}, ${next.eta === 0 ? "this month" : monthLabel(start, next.eta!)}` : "Every badge your plan can reach is yours"}
          </Text>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>All badges →</Text>
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  dots: { flexDirection: "row", gap: 4 },
  dot: { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
});
