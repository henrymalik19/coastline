/**
 * The YNAB import, and undoing it, wait while this device is syncing: an import before your account's
 * transactions have loaded here would miss them (and add YNAB's copies beside them), and either one in
 * the middle of a big upload can leave other devices half-changed for a while.
 */
import type { SyncStatus } from "./sync";

type SyncState = { status: SyncStatus; userId?: string; progress?: string; lastSyncedAt?: number };

/** Why the import or its undo has to wait, in a few words; null when it can go ahead. */
export function importWait(s: SyncState): string | null {
  // not signed in (or no syncing at all): everything is on this device
  if (!s.userId || s.status === "off" || s.status === "signedOut") return null;
  if (s.status === "syncing" || s.progress) return "Waiting for sync to finish…";
  // signed in, but your account hasn't loaded on this device yet (offline, or it failed)
  if (!s.lastSyncedAt) return s.status === "offline" ? "Connect to load your account first." : "Loading your account first…";
  return null;
}
