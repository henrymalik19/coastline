import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { ConfirmHost } from "../components/ConfirmHost";
import { rollForwardNow } from "../lib/rollForwardNow";
import { useStore } from "../lib/store";
import { startSync } from "../lib/sync";
import { useTheme } from "../lib/theme";

/**
 * Web: the page itself never scrolls or bounces sideways (on a phone, a stray swipe near the tab
 * bar shouldn't shift the app). Rows meant to swipe sideways (chips) scroll inside themselves.
 */
const WEB_PAGE_CSS = `
html, body, #root { max-width: 100%; overflow-x: hidden; overscroll-behavior-x: none; }
body { overscroll-behavior-y: none; }
/* scrollbars: thin, in the theme's colors (set on <html> below), not the browser's bright default */
* { scrollbar-width: thin; scrollbar-color: var(--sb-thumb, #8a9aa6) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track, *::-webkit-scrollbar-corner { background: transparent; }
*::-webkit-scrollbar-thumb { background-color: var(--sb-thumb, #8a9aa6); border-radius: 999px; border: 3px solid transparent; background-clip: content-box; }
*::-webkit-scrollbar-thumb:hover { background-color: var(--sb-thumb-hover, #5f6a72); }
`;

export default function RootLayout() {
  const t = useTheme();
  useEffect(() => startSync(), []);
  // changes whose month has come move into their fields (once saved data has loaded, and on return)
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  useEffect(() => {
    if (hydrated && onboarded) rollForwardNow();
  }, [hydrated, onboarded]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => st === "active" && rollForwardNow());
    const onFocus = () => rollForwardNow();
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("focus", onFocus);
    return () => {
      sub.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("focus", onFocus);
    };
  }, []);
  // the scrollbars (and form controls) follow light / dark
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.colorScheme = t.scheme;
    root.style.setProperty("--sb-thumb", t.border);
    root.style.setProperty("--sb-thumb-hover", t.text3);
  }, [t.scheme, t.border, t.text3]);
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
      <ConfirmHost />
    </>
  );
}
