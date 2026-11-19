/**
 * Admin (only for admin accounts): how many people use Coastwise, and the diagnostic reports they
 * send, newest first. Tap a report to see all of it; remove it once it's dealt with.
 */
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../../components/form";
import { Card, Screen, Stat } from "../../../components/ui";
import { deleteReport, loadAdmin, useIsAdmin, type AdminReport, type AdminStats } from "../../../lib/admin";
import { confirm } from "../../../lib/confirm";
import { reportText } from "../../../lib/diagnostics";
import { radius, space, type, useTheme } from "../../../lib/theme";

const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const n = (s: AdminStats, k: string) => (s[k] ?? 0).toLocaleString();

export default function Admin() {
  const t = useTheme();
  const isAdmin = useIsAdmin();
  const [data, setData] = useState<{ stats: AdminStats; reports: AdminReport[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await loadAdmin());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const remove = async (r: AdminReport) => {
    if (!(await confirm("Remove this report?", "It's deleted for good.", "Remove"))) return;
    try {
      await deleteReport(r.id);
      setData((d) => (d ? { ...d, reports: d.reports.filter((x) => x.id !== r.id) } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it.");
    }
  };

  if (!isAdmin)
    return (
      <Screen title="Admin" narrow back="/settings">
        <Card>
          <Text style={[type.body, { color: t.text2 }]}>This page is only for admin accounts.</Text>
        </Card>
      </Screen>
    );

  const s = data?.stats ?? {};
  return (
    <Screen title="Admin" subtitle="Who uses Coastwise, and the reports they send" narrow back="/settings">
      <Card style={{ gap: space.md }}>
        <View style={styles.head}>
          <Text style={[type.heading, { color: t.text, flex: 1 }]}>Usage</Text>
          <Button title={busy ? "Loading…" : "Refresh"} tone="ghost" disabled={busy} onPress={() => void load()} style={{ minHeight: 32 }} />
        </View>
        {data ? (
          <View style={styles.grid}>
            <View style={styles.cell}><Stat label="Accounts" value={n(s, "accounts")} hint={`${n(s, "new_this_week")} new this week`} /></View>
            <View style={styles.cell}><Stat label="Active this week" value={n(s, "active_this_week")} info="Signed-in accounts whose app was open this week." /></View>
            <View style={styles.cell}><Stat label="Plans set up" value={n(s, "plans_set_up")} hint={`${n(s, "ynab_imports")} imported from YNAB`} /></View>
            <View style={styles.cell}>
              <Stat label="Still using after a month" value={`${n(s, "still_active_4_weeks_later")} of ${n(s, "signed_up_4_weeks_ago")}`} info="Of the people who signed up 4 to 5 weeks ago, how many used it this week." />
            </View>
          </View>
        ) : null}
        <Text style={[type.caption, { color: t.text3 }]}>People using Coastwise without an account don't show up here.</Text>
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text style={[type.heading, { color: t.text }]}>
          Diagnostic reports{data ? ` · ${n(s, "reports")}` : ""}
        </Text>
        {data && !data.reports.length ? <Text style={[type.body, { color: t.text2 }]}>None yet.</Text> : null}
        {data?.reports.map((r) => {
          const on = open === r.id;
          const rep = r.report as Record<string, unknown>;
          const err = rep.syncError && rep.syncError !== "—" ? String(rep.syncError) : "";
          return (
            <View key={r.id} style={[styles.report, { borderTopColor: t.border }]}>
              <Pressable role="button" aria-expanded={on} onPress={() => setOpen(on ? null : r.id)} style={{ gap: 2 }}>
                <View style={styles.head}>
                  <Text style={[type.body, { color: t.text, fontWeight: "600", flex: 1 }]} numberOfLines={1}>{r.email ?? "A deleted account"}</Text>
                  <Text style={[type.caption, { color: t.text3 }]}>{when(r.created_at)}</Text>
                </View>
                <Text style={[type.caption, { color: t.text2 }]} numberOfLines={on ? undefined : 2}>
                  {r.note ? `“${r.note}”` : "No note"} · version {String(rep.version ?? "?")} · {String(rep.syncStatus ?? "?")}
                  {err ? ` · ${err}` : ""}
                </Text>
              </Pressable>
              {on ? (
                <View style={{ gap: space.sm }}>
                  <Text selectable style={[type.caption, styles.mono, { color: t.text2, backgroundColor: t.surface2 }]}>
                    {reportText(rep as Parameters<typeof reportText>[0])}
                  </Text>
                  <Button title="Remove" tone="ghost" onPress={() => void remove(r)} style={{ alignSelf: "flex-start", minHeight: 32 }} />
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
      {error ? <Text role="alert" style={[type.label, { color: t.bad }]}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: space.md },
  cell: { width: "50%", paddingRight: space.sm },
  report: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: space.sm },
  mono: { borderRadius: radius.sm, padding: space.sm, fontFamily: Platform.OS === "web" ? "ui-monospace, Menlo, Consolas, monospace" : undefined },
});
