import { Redirect, Tabs, useRouter } from "expo-router";
import { useMembership } from "../../lib/sharing";
import { useStore } from "../../lib/store";
import { Platform, StyleSheet } from "react-native";
import { Icon, type IconName } from "../../components/Icon";
import { Sidebar } from "../../components/Sidebar";
import { useMonthRecord } from "../../lib/history";
import { useBankAutoSync } from "../../lib/plaid";
import { useIsWide } from "../../lib/layout";
import { useTheme } from "../../lib/theme";

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "home", title: "Home", icon: "home" },
  { name: "plan", title: "Forecast", icon: "plan" },
  { name: "budget", title: "Budget", icon: "card" },
  { name: "money", title: "Money", icon: "wallet" },
];
const ICONS = { ...Object.fromEntries(TABS.map((t) => [t.name, t.icon])), settings: "gear" } as Record<string, IconName>;

export default function TabsLayout() {
  const router = useRouter();
  const t = useTheme();
  const wide = useIsWide();
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  const member = useMembership((s) => s.status);
  // this month's balances record (the history on Forecast), kept up to date as balances change
  useMonthRecord();
  // connected banks: refresh balances once when the app opens (signed in)
  useBankAutoSync();
  // the app has nothing to show until setup is done (e.g. a bookmarked link on a fresh device);
  // someone who adds purchases on another plan's cards goes to their shared budget
  if (hydrated && !onboarded) return <Redirect href={member === "member" ? "/shared" : "/onboarding"} />;
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
        // the tabs share the width; a long label (or big phone text) must never widen the bar
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
          // Money always opens on its list, not the last Money page you had open (like the YNAB import)
          listeners={tab.name === "money" ? { tabPress: (e) => { e.preventDefault(); router.navigate("/money"); } } : undefined}
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
      {/* Progress moved into Forecast and Home; these are its pages, and old links redirect */}
      <Tabs.Screen name="progress" options={{ title: "Progress", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
      <Tabs.Screen name="number" options={{ title: "Your number", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
      <Tabs.Screen name="badges" options={{ title: "Badges", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
    </Tabs>
  );
}
