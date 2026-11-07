import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { startSync } from "../lib/sync";
import { useTheme } from "../lib/theme";

/**
 * Web: the page itself never scrolls or bounces sideways (on a phone, a stray swipe near the tab
 * bar shouldn't shift the app). Rows meant to swipe sideways (chips) scroll inside themselves.
 */
const WEB_PAGE_CSS = `
html, body, #root { max-width: 100%; overflow-x: hidden; overscroll-behavior-x: none; }
body { overscroll-behavior-y: none; }
`;

export default function RootLayout() {
  const t = useTheme();
  useEffect(() => startSync(), []);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || document.getElementById("coastline-page-css")) return;
    const style = document.createElement("style");
    style.id = "coastline-page-css";
    style.textContent = WEB_PAGE_CSS;
    document.head.appendChild(style);
  }, []);
  return (
    <>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
    </>
  );
}
