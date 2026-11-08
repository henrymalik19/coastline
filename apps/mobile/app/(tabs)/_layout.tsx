import { Redirect, Tabs } from "expo-router";
import { useStore } from "../../lib/store";
import { Platform, StyleSheet } from "react-native";
import { Icon, type IconName } from "../../components/Icon";
import { Sidebar } from "../../components/Sidebar";
import { useIsWide } from "../../lib/layout";
import { useTheme } from "../../lib/theme";

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "home", title: "Home", icon: "home" },
  { name: "plan", title: "Forecast", icon: "plan" },
  { name: "budget", title: "Budget", icon: "card" },
  { name: "money", title: "Money", icon: "wallet" },
  { name: "progress", title: "Progress", icon: "trend" },
];
const ICONS = { ...Object.fromEntries(TABS.map((t) => [t.name, t.icon])), settings: "gear" } as Record<string, IconName>;

export default function TabsLayout() {
  const t = useTheme();
  const wide = useIsWide();
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  // the app has nothing to show until setup is done (e.g. a bookmarked link on a fresh device)
  if (hydrated && !onboarded) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      // Desktop web: sidebar on the left. Phones (native and narrow web): bottom tabs.
      tabBar={wide ? (props) => <Sidebar {...props} icons={ICONS} /> : undefined}
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? "left" : "bottom",
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.text3,
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
        // five tabs share the width; a long label (or big phone text) must never widen the bar
        tabBarItemStyle: { minWidth: 0, overflow: "hidden" },
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          ...(Platform.OS === "web" ? { height: 68, paddingTop: 6, paddingBottom: 10 } : {}),
        },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color }) => <Icon name={tab.icon} size={24} color={String(color)} />,
          }}
        />
      ))}
      {/* Settings: not in the bottom tab bar (gear in the header on phones; sidebar item on desktop) */}
      {/* note: `href: null` would make the route redirect away in this expo-router version */}
      {/* the old Monthly tab: still reachable from Plan → Forecast, no longer in the tab bar */}
      {/* Transactions moved into Budget (Budget → Transactions); old links redirect there */}
      <Tabs.Screen name="transactions" options={{ title: "Transactions", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
      <Tabs.Screen name="monthly" options={{ title: "Monthly", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
      <Tabs.Screen name="emergency" options={{ title: "Emergency mode", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
    </Tabs>
  );
}
