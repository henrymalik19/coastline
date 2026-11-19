/**
 * Which version of the app is running: the commit it was built from and when (baked in at build time
 * by scripts/build-web.mjs; "dev" when run locally). On the web, the open app checks now and then
 * whether a newer version is live (dist/version.json), so a tab left open for days can say so.
 */
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

export const COMMIT = process.env.EXPO_PUBLIC_COMMIT || "dev";
export const BUILT_AT = process.env.EXPO_PUBLIC_BUILT_AT || "";

/** "Version 6af5a20 · Nov 19, 2026, 2:31 PM" (or "Version dev"). */
export function versionText(): string {
  const d = BUILT_AT ? new Date(BUILT_AT) : null;
  const when = d && !Number.isNaN(d.getTime()) ? ` · ${d.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
  return `Version ${COMMIT}${when}`;
}

/** A newer version is live than this one (`live`: what version.json says). */
export const isNewer = (live: unknown, mine = COMMIT): boolean =>
  mine !== "dev" && !!live && typeof (live as { commit?: unknown }).commit === "string" && (live as { commit: string }).commit !== mine && (live as { commit: string }).commit !== "dev";

/** How often an open app looks (it also looks when you come back to it). */
const EVERY = 30 * 60 * 1000;

/** True once a newer version is live (web only; never while running locally). */
export function useNewVersion(): boolean {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web" || COMMIT === "dev" || typeof window === "undefined") return;
    let last = 0;
    const check = () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      fetch("/version.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => isNewer(v) && setNewer(true))
        .catch(() => undefined);
    };
    check();
    const id = setInterval(check, EVERY);
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    window.addEventListener("focus", check);
    return () => {
      clearInterval(id);
      sub.remove();
      window.removeEventListener("focus", check);
    };
  }, []);
  return newer;
}
