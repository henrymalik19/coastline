import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { startSync } from "../lib/sync";
import { useTheme } from "../lib/theme";

export default function RootLayout() {
  const t = useTheme();
  useEffect(() => startSync(), []);
  return (
    <>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
    </>
  );
}
