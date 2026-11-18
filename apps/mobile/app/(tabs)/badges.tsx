import { StyleSheet, Text, View } from "react-native";
import { Card, Screen, SectionLabel } from "../../components/ui";
import { ProgressBar } from "../../components/ProgressRing";
import { badgeList } from "../../lib/badges";
import { monthLabel } from "../../lib/format";
import { useStreak } from "../../lib/history";
import { useLayout } from "../../lib/layout";
import { usePlan } from "../../lib/plan";
import { radius, space, type, useTheme } from "../../lib/theme";

/** Every badge, your level and your streak (opened from Home's rewards card). */
export default function Badges() {
  const t = useTheme();
  const { twoColumn, statColumns } = useLayout();
  const { state, result: o, start } = usePlan();
  const streak = useStreak();
  const badges = badgeList(state, o, streak);
  const got = badges.filter((b) => b.got).length;
  const cols = statColumns === 4 ? (twoColumn ? 6 : 4) : 2;
  const rows: (typeof badges)[] = [];
  for (let i = 0; i < badges.length; i += cols) rows.push(badges.slice(i, i + cols));
  return (
    <Screen title="Badges" subtitle={`Level ${got + 1} · ${got} of ${badges.length}`} back="/home">
      <Card style={{ gap: space.sm }}>
        <SectionLabel>Level {got + 1}</SectionLabel>
        <ProgressBar progress={got / badges.length} />
        <Text style={[type.caption, { color: t.text3 }]}>{got} of {badges.length} badges. Locked ones show when your plan gets you there.</Text>
      </Card>
      <Card style={{ gap: space.sm }}>
        {rows.map((row, r) => (
          <View key={r} style={{ flexDirection: "row", gap: space.sm }}>
            {row.map((bd) => (
              <View
                key={bd.key}
                accessible
                accessibilityLabel={`${bd.title}: ${bd.desc}. ${bd.got ? "Unlocked" : bd.eta !== null ? `Locked, plan unlocks ${monthLabel(start, bd.eta)}` : "Locked"}`}
                style={[styles.badge, { borderColor: bd.got ? t.good : t.border, backgroundColor: bd.got ? t.surface : t.surface2, borderStyle: bd.got ? "solid" : "dashed" }]}
              >
                <Text style={{ fontSize: 22, opacity: bd.got ? 1 : 0.45 }}>{bd.icon}</Text>
                <Text style={[type.label, { color: t.text, fontWeight: "600" }]} numberOfLines={1}>{bd.title}</Text>
                <Text style={[type.caption, { color: t.text3 }]} numberOfLines={2}>{bd.desc}</Text>
                <Text style={[type.caption, { color: bd.got ? t.good : t.text3, fontWeight: "600" }]}>
                  {bd.got ? "✓ Unlocked" : bd.eta !== null ? `🔒 ${bd.eta === 0 ? "This month" : monthLabel(start, bd.eta)}` : "🔒 Locked"}
                </Text>
              </View>
            ))}
            {Array.from({ length: cols - row.length }, (_, k) => <View key={`f${k}`} style={{ flex: 1 }} />)}
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 3, minWidth: 0 },
});
