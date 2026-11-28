import { usePathname, useRouter } from "expo-router";
import { Platform } from "react-native";

/** A path inside the app (not another site), safe to send Back to. */
export const isAppPath = (p: unknown): p is string => typeof p === "string" && /^\/[A-Za-z0-9/_-]*$/.test(p) && !p.startsWith("//");

/**
 * Switch a page's view (its ?view= and friends) as its own step in the browser's history, so the
 * browser's Back button returns to the view you were on (a URL param change alone replaces the entry).
 * The current entry is copied first; the router then rewrites the copy with the new params.
 */
export function useSetView() {
  const router = useRouter();
  return (params: Record<string, string | undefined>) => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const now = new URLSearchParams(window.location.search);
      const next = new URLSearchParams(now);
      for (const [k, v] of Object.entries(params)) (v === undefined ? next.delete(k) : next.set(k, v));
      // already showing it: no new step
      if (next.toString() === now.toString()) return;
      window.history.pushState(window.history.state, "", window.location.href);
    }
    router.setParams(params as never);
  };
}

/**
 * Open a Money or Settings page from somewhere else, so its Back button returns to this screen
 * (instead of the Money or Settings list).
 */
export function useOpenPage() {
  const router = useRouter();
  const here = usePathname();
  return (path: string) => {
    if (!isAppPath(here)) return router.push(path as never);
    const sep = path.includes("?") ? "&" : "?";
    router.push(`${path}${sep}back=${encodeURIComponent(here)}` as never);
  };
}
