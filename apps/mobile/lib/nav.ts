import { usePathname, useRouter } from "expo-router";

/** A path inside the app (not another site), safe to send Back to. */
export const isAppPath = (p: unknown): p is string => typeof p === "string" && /^\/[A-Za-z0-9/_-]*$/.test(p) && !p.startsWith("//");

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
