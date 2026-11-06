import type { BottomTabBarProps } from "expo-router/tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { percent } from "../lib/format";
import { SIDEBAR_WIDTH } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { radius, space, type, useTheme } from "../lib/theme";
import { Icon, type IconName } from "./Icon";
import { ProgressBar } from "./ProgressRing";

/** Desktop web navigation: replaces the bottom tab bar on wide windows. */
export function Sidebar({ state, descriptors, emitter, navigateToTab, icons }: BottomTabBarProps & { icons: Record<string, IconName> }) {
  const t = useTheme();
  const { result, isSample } = usePlan();

  return (
    <View role="navigation" aria-label="Main" style={[styles.bar, { backgroundColor: t.surface, borderRightColor: t.border }]}>
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: t.accent }]}>
          <Icon name="trend" size={18} color="#fff" />
        </View>
        <View>
          <Text style={[type.heading, { color: t.text }]}>Coast FI</Text>
          <Text style={[type.caption, { color: t.text3 }]}>Planner</Text>
        </View>
      </View>

      <View style={{ gap: 2 }}>
        {state.routes.map((route, index) => {
          const focused = index === state.index;
          const { options } = descriptors[route.key]!;
          const label = options.title ?? route.name;
          const onPress = () => {
            const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigateToTab(route.key);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              role="link"
              aria-current={focused ? "page" : undefined}
              accessibilityLabel={label}
              style={(s) => {
                // react-native-web adds `hovered`; RN's types don't declare it
                const hovered = (s as typeof s & { hovered?: boolean }).hovered;
                return [styles.item, { backgroundColor: focused ? t.accentSoft : s.pressed || hovered ? t.surface2 : "transparent" }];
              }}
            >
              <Icon name={icons[route.name] ?? "home"} size={20} color={focused ? t.accent : t.text2} />
              <Text style={[type.body, { color: focused ? t.accent : t.text2, fontWeight: focused ? "600" : "500" }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }} />

      <View style={[styles.summary, { backgroundColor: t.surface2 }]}>
        <View style={styles.between}>
          <Text style={[type.label, { color: t.text2 }]}>Coast FI progress</Text>
          <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{percent(Math.min(result.progress, 9.99))}</Text>
        </View>
        <ProgressBar progress={result.progress} />
        {isSample ? <Text style={[type.caption, { color: t.text3 }]}>Showing the sample plan</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { width: SIDEBAR_WIDTH, height: "100%", borderRightWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.xl },
  brand: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xs, paddingTop: space.sm },
  logo: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  item: { flexDirection: "row", alignItems: "center", gap: space.md, height: 42, paddingHorizontal: space.md, borderRadius: 10 },
  summary: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
