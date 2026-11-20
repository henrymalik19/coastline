/**
 * The first sync of a plan on a device (it has never synced this plan): whose copy to keep.
 * - "ask": both have a finished plan and they differ. The newer one isn't always the one you want (a
 *   setup just made here is newer than your real plan), so the person picks.
 * - "account": take the account's copy (picked, or it's newer, or this device's setup isn't finished).
 * - "device": keep this device's copy and replace the account's (picked).
 * - "keep": this device's copy is newer, or the two are the same: keep it, it uploads as usual.
 */
import { deepEqual } from "./merge";

export type FirstSync = "ask" | "account" | "device" | "keep";

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
