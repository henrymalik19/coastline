import { Tabs } from "expo-router";
import { Platform, StyleSheet } from "react-native";
import { Icon, type IconName } from "../../components/Icon";
import { useTheme } from "../../lib/theme";

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "home", title: "Home", icon: "home" },
  { name: "plan", title: "Plan", icon: "plan" },
  { name: "monthly", title: "Monthly", icon: "calendar" },
  { name: "progress", title: "Progress", icon: "trend" },
];

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.text3,
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
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
    </Tabs>
  );
}
