/**
 * The first sync of a plan on a device (it has never synced this plan): whose copy to keep.
 * - "ask": both have a finished plan and they differ. The newer one isn't always the one you want (a
 *   setup just made here is newer than your real plan), so the person picks.
 * - "account": take the account's copy (picked, or it's newer, or this device's setup isn't finished).
 * - "device": keep this device's copy and replace the account's (picked).
 * - "keep": this device's copy is newer, or the two are the same: keep it, it uploads as usual.
 */
import type { Checkin } from "@coastfi/schema";
import { deepEqual } from "./merge";

/**
 * The server's check-ins taken into this device's: a month only the server has comes in; a month both
 * have keeps the newer copy (one without an edit time counts as oldest; a tie keeps this device's).
 * Null when nothing changes.
 */
export function mergeCheckinLists(local: Checkin[], remote: Checkin[]): Checkin[] | null {
  const by = new Map(local.map((c) => [c.month, c]));
  let changed = false;
  for (const r of remote) {
    const mine = by.get(r.month);
    if (!mine || (r.updatedAt ?? 0) > (mine.updatedAt ?? 0)) {
      by.set(r.month, r);
      changed = true;
    }
  }
  return changed ? [...by.values()].sort((a, b) => a.month.localeCompare(b.month)) : null;
}

export type FirstSync = "ask" | "account" | "device" | "keep";

/**
 * A later sync (this device synced this plan before, `base` is that copy):
 * - "none": nobody saved since; this device's own changes (if any) upload as usual.
 * - "take": someone saved since and this device changed nothing (or its setup isn't finished): take theirs.
 * - "merge": both changed: keep both sets of changes, part by part (lib/merge.ts).
 */
export function laterSyncAction(
  base: { at: number; plan: unknown; todoDone: unknown },
  local: { plan: unknown; todoDone: unknown; onboarded: boolean },
  remote: { at: number; onboarded: boolean },
): "none" | "take" | "merge" {
  if (remote.at === base.at) return "none";
  const localChanged = !deepEqual(base.plan, local.plan) || !deepEqual(base.todoDone, local.todoDone);
  return !localChanged || (remote.onboarded && !local.onboarded) ? "take" : "merge";
}

export function firstSyncAction(
  local: { plan: unknown; onboarded: boolean; updatedAt: number },
  remote: { plan: unknown; onboarded: boolean; at: number },
  pick?: "account" | "device",
): FirstSync {
  if (pick) return pick;
  if (remote.onboarded && local.onboarded && !deepEqual(local.plan, remote.plan)) return "ask";
  if (remote.at > local.updatedAt || (remote.onboarded && !local.onboarded)) return "account";
  return "keep";
}
