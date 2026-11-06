import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useTheme } from "../lib/theme";

export default function RootLayout() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
    </>
  );
}
