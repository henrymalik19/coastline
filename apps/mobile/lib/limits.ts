/**
 * Contribution limits (401(k), IRA, HSA by year) are the same for everyone: one shared table on the
 * server, updated when the IRS announces new limits. The app keeps the last copy it loaded (so it
 * works offline) and falls back to the limits built into the engine.
 */
import { DEFAULT_LIMITS, type LimitsRow } from "@coastfi/engine";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { supabase } from "./supabase";

export const useLimits = create<{ rows: LimitsRow[] }>()(
  persist(() => ({ rows: DEFAULT_LIMITS }), { name: "coastfi.limits", version: 1, storage: createJSONStorage(() => AsyncStorage) }),
);

type Row = { year: number; k401: number; k401_catch: number; ira: number; ira_catch: number; hsa_self: number; hsa_family: number; hsa_catch: number };

/** Load the shared limits (anyone can read them, signed in or not). Keeps the last copy if offline. */
export async function loadLimits(): Promise<void> {
  if (!supabase) return;
  const res = await supabase.from("contribution_limit").select("year, k401, k401_catch, ira, ira_catch, hsa_self, hsa_family, hsa_catch").order("year");
  if (res.error || !res.data?.length) return;
  const rows = (res.data as Row[]).map((r) => ({
    year: Number(r.year), k401: Number(r.k401), k401Catch: Number(r.k401_catch), ira: Number(r.ira), iraCatch: Number(r.ira_catch),
    hsaSelf: Number(r.hsa_self), hsaFamily: Number(r.hsa_family), hsaCatch: Number(r.hsa_catch),
  }));
  if (JSON.stringify(rows) !== JSON.stringify(useLimits.getState().rows)) useLimits.setState({ rows });
}
