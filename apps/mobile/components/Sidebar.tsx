import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { percent } from "../lib/format";
import { SIDEBAR_WIDTH } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { radius, space, type, useTheme } from "../lib/theme";
import { Icon, type IconName } from "./Icon";
import { SyncStatusLine } from "./AccountPanel";
import { ProgressBar } from "./ProgressRing";

/** Desktop web navigation: replaces the bottom tab bar on wide windows. */
export function Sidebar({ state, descriptors, emitter, navigateToTab, icons }: BottomTabBarProps & { icons: Record<string, IconName> }) {
  const t = useTheme();
  const router = useRouter();
  const { result } = usePlan();
  const settingsRoute = state.routes.find((r) => r.name === "settings");
  const focusedName = state.routes[state.index]?.name;

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
          if (route.name === "settings" || !(route.name in icons)) return null;
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

      {settingsRoute ? (
        <Pressable
          onPress={() => {
            // always land on the settings index, even if a sub-page was open
            if (focusedName === "settings") router.navigate("/settings");
            else navigateToTab(settingsRoute.key);
          }}
          role="link"
          aria-current={focusedName === "settings" ? "page" : undefined}
          accessibilityLabel="Settings"
          style={(s) => {
            const hovered = (s as typeof s & { hovered?: boolean }).hovered;
            const on = focusedName === "settings";
            return [styles.item, { backgroundColor: on ? t.accentSoft : s.pressed || hovered ? t.surface2 : "transparent", marginBottom: -space.md }];
          }}
        >
          <Icon name="gear" size={20} color={focusedName === "settings" ? t.accent : t.text2} />
          <Text style={[type.body, { color: focusedName === "settings" ? t.accent : t.text2, fontWeight: focusedName === "settings" ? "600" : "500" }]}>Settings</Text>
        </Pressable>
      ) : null}

      <View style={[styles.summary, { backgroundColor: t.surface2 }]}>
        <View style={styles.between}>
          <Text style={[type.label, { color: t.text2 }]}>Coast FI progress</Text>
          <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{percent(Math.min(result.progress, 9.99))}</Text>
        </View>
        <ProgressBar progress={result.progress} />
        <SyncStatusLine />
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
