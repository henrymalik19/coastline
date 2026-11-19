/**
 * The Admin page (Settings → Admin): usage numbers and the diagnostic reports people send. Only for
 * accounts in app_admin (added by hand on the server); the server checks every call, the app only
 * decides whether to show the page.
 */
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useSync } from "./sync";

export type AdminReport = { id: string; created_at: string; email: string | null; note: string | null; report: Record<string, unknown> };
export type AdminStats = Record<string, number>;

/** True when the signed-in account is an admin (false while unknown, signed out, or offline). */
export function useIsAdmin(): boolean {
  const userId = useSync((s) => s.userId);
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    setAdmin(false);
    if (!supabase || !userId) return;
    let live = true;
    supabase.rpc("is_admin").then(
      ({ data }) => live && setAdmin(data === true),
      () => undefined,
    );
    return () => { live = false; };
  }, [userId]);
  return admin;
}

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

export async function loadAdmin(limit = 50): Promise<{ stats: AdminStats; reports: AdminReport[] }> {
  if (!supabase) throw new Error("Not set up in this build.");
  const [s, r] = await Promise.all([supabase.rpc("admin_stats"), supabase.rpc("admin_reports", { p_limit: limit })]);
  fail(s.error);
  fail(r.error);
  return { stats: (s.data ?? {}) as AdminStats, reports: (r.data ?? []) as AdminReport[] };
}

export async function deleteReport(id: string): Promise<void> {
  if (!supabase) return;
  const r = await supabase.rpc("admin_delete_report", { p_id: id });
  fail(r.error);
}
