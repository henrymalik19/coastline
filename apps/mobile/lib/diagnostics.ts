/**
 * A short report on how the app is doing on this device, to help with a problem: its version, the
 * device, how much it holds, and how sync is doing. No amounts, names, payees or transactions.
 * Copy it, or send it (signed in): it's saved with your account where Coastwise can look at it.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isHistoryTxn, type Txn } from "@coastfi/engine";
import { Platform } from "react-native";
import { useStore } from "./store";
import { supabase } from "./supabase";
import { useSync } from "./sync";
import { BUILT_AT, COMMIT } from "./version";

export type Report = Record<string, string | number | boolean | null>;

const when = (ms?: number) => (ms ? new Date(ms).toISOString() : null);

/** The parts that come from the store and sync (pure, for tests). */
export function reportFrom(s: {
  txns: Txn[];
  accounts: number;
  debts: number;
  categories: number;
  checkins: number;
  importedAt?: number;
  ynabSyncedAt?: number;
  pushedAt?: number;
  sync: { status: string; lastSyncedAt?: number; error?: string; progress?: string };
}): Report {
  const live = s.txns.filter((t) => !t.deleted);
  const pushed = s.pushedAt ?? 0;
  return {
    transactions: live.length,
    history: live.filter(isHistoryTxn).length,
    deletedKept: s.txns.length - live.length,
    waitingToUpload: s.txns.filter((t) => t.updatedAt > pushed).length,
    accounts: s.accounts,
    debts: s.debts,
    categories: s.categories,
    checkins: s.checkins,
    importedAt: when(s.importedAt),
    ynabUpdatedAt: when(s.ynabSyncedAt),
    syncStatus: s.sync.status,
    lastSynced: when(s.sync.lastSyncedAt),
    syncError: s.sync.error ?? null,
    syncProgress: s.sync.progress ?? null,
  };
}

/** Everything in the report, as of now. */
export async function buildReport(): Promise<Report> {
  const st = useStore.getState();
  const sy = useSync.getState();
  const r: Report = {
    version: COMMIT,
    builtAt: BUILT_AT || null,
    at: new Date().toISOString(),
    platform: Platform.OS,
    signedIn: sy.status !== "off" && sy.status !== "signedOut",
    ...reportFrom({
      txns: st.txns, accounts: st.plan.accounts.length, debts: st.plan.debts.length, categories: st.plan.budget.length, checkins: st.checkins.length,
      importedAt: st.importedAt, ynabSyncedAt: st.ynabSyncedAt, pushedAt: st.txnPushed?.at, sync: sy,
    }),
  };
  try {
    r.savedChars = (await AsyncStorage.getItem("coastfi.app"))?.length ?? 0;
  } catch {
    r.savedChars = null;
  }
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    r.browser = navigator.userAgent.slice(0, 200);
    if (typeof window !== "undefined") r.screen = `${window.innerWidth}x${window.innerHeight}`;
    r.online = navigator.onLine;
    try {
      const e = await navigator.storage?.estimate?.();
      if (e) {
        r.storageUsedMB = Math.round(((e.usage ?? 0) / 1e6) * 10) / 10;
        r.storageQuotaMB = Math.round((e.quota ?? 0) / 1e6);
      }
    } catch {
      // not available in this browser
    }
  }
  return r;
}

/** The report as text, one "name: value" a line (to copy or read). */
export const reportText = (r: Report): string => Object.entries(r).map(([k, v]) => `${k}: ${v ?? "—"}`).join("\n");

/** Send it with your account (signed in). Throws a readable error. */
export async function sendReport(r: Report, note: string): Promise<void> {
  if (!supabase) throw new Error("Sending isn't set up in this build. Copy it instead.");
  const res = await supabase.from("diagnostic_report").insert({ report: r, note: note.trim() || null });
  if (res.error) throw new Error(/diagnostic_report|PGRST205|42P01/.test(res.error.message + res.error.code) ? "Sending isn't ready yet. Copy it instead." : res.error.message);
}

/** Copy text (web: the clipboard). False when it couldn't. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // blocked
  }
  return false;
}
