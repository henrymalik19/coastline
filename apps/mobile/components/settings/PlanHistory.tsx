/**
 * Settings → Data → Earlier versions: the copies of your plan your account keeps (one before it
 * changes, at most every 10 minutes while you edit, and before anything big), for 30 days. Open one
 * to see what's in it and bring it back. Transactions and check-ins aren't part of a version.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { confirm } from "../../lib/confirm";
import { listPlanVersions, loadPlanVersion, restorePlanVersion, useSync, type PlanVersion } from "../../lib/sync";
import { space, type, useTheme } from "../../lib/theme";
import { Button } from "../form";

const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function PlanHistory() {
  const t = useTheme();
  const userId = useSync((s) => s.userId);
  const [list, setList] = useState<PlanVersion[] | null>(null);
  const [open, setOpen] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error && e.message ? e.message : "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  };
  const show = (v: PlanVersion) =>
    void run(async () => {
      if (open?.id === v.id) return setOpen(null);
      const got = await loadPlanVersion(v.id);
      if (!got) throw new Error("This version couldn't be read.");
      const c = got.counts;
      setOpen({ id: v.id, text: `${plural(c.categories, "category", "categories")} · ${plural(c.accounts, "account")} · ${plural(c.goals, "goal")}` });
    });
  const restore = (v: PlanVersion) =>
    void run(async () => {
      if (!(await confirm(`Restore the version from ${when(v.saved_at)}?`, "Your plan goes back to how it was then, on every device. Your plan as it is now is kept here first, so you can switch back. Transactions and check-ins don't change.", "Restore"))) return;
      await restorePlanVersion(v.id);
      setOpen(null);
      setList(await listPlanVersions());
      setMsg({ ok: true, text: "Restored. Your plan is back to that version." });
    });

  if (!userId)
    return <Text style={[type.body, { color: t.text2, paddingVertical: space.sm }]}>Sign in to keep earlier versions of your plan in your account.</Text>;

  return (
    <View style={{ paddingVertical: space.sm, gap: space.md }}>
      <Text style={[type.body, { color: t.text2 }]}>
        Your account keeps a copy of your plan before it changes, for 30 days, so you can go back if something goes wrong. Transactions and check-ins aren't part of it.
      </Text>
      {list === null ? (
        <Button title={busy ? "Loading…" : "Show earlier versions"} disabled={busy} onPress={() => void run(async () => setList(await listPlanVersions()))} style={{ alignSelf: "flex-start" }} />
      ) : list.length ? (
        <View>
          {list.map((v, i) => (
            <View key={v.id} style={[styles.row, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border } : null]}>
              <Pressable role="button" aria-expanded={open?.id === v.id} onPress={() => show(v)} style={{ gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Text style={[type.body, { color: t.text, flex: 1 }]}>{when(v.saved_at)}</Text>
                  <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{open?.id === v.id ? "Hide" : "Look"}</Text>
                </View>
                <Text style={[type.caption, { color: t.text3 }]}>{v.note ?? "Before a change"}</Text>
              </Pressable>
              {open?.id === v.id ? (
                <View style={{ gap: space.sm, paddingTop: space.sm }}>
                  <Text style={[type.caption, { color: t.text2 }]}>{open.text}</Text>
                  <Button title="Restore this version" disabled={busy} onPress={() => restore(v)} style={{ alignSelf: "flex-start", minHeight: 36 }} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={[type.caption, { color: t.text3 }]}>None yet. A copy is kept the next time your plan changes.</Text>
      )}
      {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: space.sm },
});
