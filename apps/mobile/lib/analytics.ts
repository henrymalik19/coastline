import { Platform } from "react-native";

/** The live site, where Vercel serves its analytics script (it doesn't exist locally). */
const LIVE_HOSTS = ["getcoastwise.com", "www.getcoastwise.com"];

/**
 * Vercel Web Analytics: counts visits, pages and which site sent people (like reddit.com), without cookies
 * and without identifying anyone. It needs no package: Vercel serves the script from the site itself once
 * Web Analytics is turned on for the project. Web only, live site only.
 */
export function startVisitCounting() {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof document === "undefined") return;
  if (!LIVE_HOSTS.includes(window.location.hostname)) return;
  if (document.querySelector('script[src="/_vercel/insights/script.js"]')) return;
  const w = window as typeof window & { va?: (...a: unknown[]) => void; vaq?: unknown[] };
  w.va = w.va || ((...a: unknown[]) => void (w.vaq = w.vaq || []).push(a));
  const s = document.createElement("script");
  s.defer = true;
  s.src = "/_vercel/insights/script.js";
  document.head.appendChild(s);
}
