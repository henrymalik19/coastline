import { Text, View } from "react-native";
import { radius, space, type, useTheme } from "../lib/theme";
import { Icon, type IconName } from "./Icon";
import { Card, Pill, Screen } from "./ui";

/** Friendly empty state for screens that arrive in Phase 2. */
export function ComingSoon({ title, subtitle, icon, heading, points }: {
  title: string; subtitle: string; icon: IconName; heading: string; points: string[];
}) {
  const t = useTheme();
  return (
    <Screen title={title} subtitle={subtitle}>
      <Card style={{ alignItems: "center", paddingVertical: space.xxl, gap: space.md }}>
        <View style={{ width: 56, height: 56, borderRadius: radius.lg, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={28} color={t.accent} />
        </View>
        <Text style={[type.heading, { color: t.text, textAlign: "center" }]}>{heading}</Text>
        <View style={{ gap: space.sm, alignSelf: "stretch", paddingHorizontal: space.sm }}>
          {points.map((p) => (
            <View key={p} style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
              <View style={{ marginTop: 2 }}><Icon name="check" size={16} color={t.good} /></View>
              <Text style={[type.body, { color: t.text2, flex: 1 }]}>{p}</Text>
            </View>
          ))}
        </View>
        <View style={{ alignSelf: "center", marginTop: space.xs }}>
          <Pill tone="accent">Coming in the next build</Pill>
        </View>
      </Card>
    </Screen>
  );
}
