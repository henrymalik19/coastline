/**
 * After the import: bring in a newer YNAB export's transactions (for using both apps side by side for a
 * while). Shows what would change first; categories, amounts, groups and accounts stay as they are.
 */
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, ToggleRow } from "./form";
import { Card } from "./ui";
import { dayText } from "./ImportUndo";
import { usePlan } from "../lib/plan";
import { monthKey, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { pickYnabFiles } from "../lib/ynabFiles";
import { planYnabUpdate, type YnabUpdate } from "../lib/ynabUpdate";
import { OUTSIDE } from "../lib/outside";
import { isHistoryTxn } from "@coastfi/engine";

type Open = "closed" | "cats" | "rest";
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;

export function YnabUpdateCard() {
  const t = useTheme();
  const { start } = usePlan();
  const plan = useStore((s) => s.plan);
  const txns = useStore((s) => s.txns);
  const lastSync = useStore((s) => s.ynabSyncedAt ?? s.importedAt ?? 0);
  const updateFromYnab = useStore((s) => s.updateFromYnab);
  const [u, setU] = useState<YnabUpdate | null>(null);
  const [file, setFile] = useState("");
  const [removeGone, setRemoveGone] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [open, setOpen] = useState<Open | null>(null);

  const pick = async () => {
    setError("");
    setDone("");
    try {
      const got = await pickYnabFiles();
      if (!got) return;
      if (!got.data.txns.length) throw new Error("No transactions in that file.");
      setFile(got.name);
      setRemoveGone(true);
      setU(planYnabUpdate(plan, got.data, txns, lastSync, monthKey(start)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };
  const apply = () => {
    if (!u) return;
    updateFromYnab(u, removeGone);
    const out = (removeGone ? u.gone.length : 0) + u.replaced.length;
    setDone(`Updated: ${n(u.add.length - u.history, "transaction")} in${u.history ? `, ${u.history.toLocaleString()} as history` : ""}${out ? `, ${out} removed` : ""}.`);
    setU(null);
  };

  const nothing = u && !u.add.length && !u.gone.length && !u.replaced.length;
  // accounts left out: closed ones whose transactions come in as history, and the rest
  const asHistory = new Set((u?.add ?? []).filter(isHistoryTxn).map((x) => x.accountId.slice(OUTSIDE.length)));
  const closed = (u?.skippedAccounts ?? []).filter((a) => asHistory.has(a));
  const rest = (u?.skippedAccounts ?? []).filter((a) => !asHistory.has(a));
  const fresh = u ? u.add.length - u.history : 0;

  /** One line of the summary: a number, what it is, and an optional note or list under it. */
  const row = (count: number, title: string, note?: string, names?: { key: Open; list: string[] }) => (
    <View style={[styles.row, { borderTopColor: t.border }]}>
      <Text style={[type.body, styles.count, { color: t.text }]}>{count.toLocaleString()}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: t.text, fontWeight: "600" }]}>{title}</Text>
        {note ? <Text style={[type.caption, { color: t.text2 }]}>{note}</Text> : null}
        {names?.list.length ? (
          <>
            <Pressable role="button" onPress={() => setOpen(open === names.key ? null : names.key)} hitSlop={6} style={{ alignSelf: "flex-start" }}>
              <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{open === names.key ? "Hide" : "Show"} {names.key === "cats" ? "them" : "accounts"}</Text>
            </Pressable>
            {open === names.key ? (
              <View style={styles.tags}>
                {names.list.map((x) => (
                  <Text key={x} style={[type.caption, styles.tag, { color: t.text2, backgroundColor: t.surface2 }]}>{x}</Text>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );

  return (
    <Card style={{ gap: space.sm }}>
      <Text style={[type.heading, { color: t.text }]}>Update transactions from YNAB</Text>
      {!u ? (
        <>
          <Text style={[type.body, { color: t.text2 }]}>
            Still using YNAB too? Pick a newer export: only its new and changed transactions come in. Your categories, amounts, groups and accounts stay as they are.
          </Text>
          {lastSync ? <Text style={[type.caption, { color: t.text3 }]}>Last brought in {dayText(lastSync)}.</Text> : null}
          {Platform.OS === "web" ? (
            <Button title="Choose a newer export" icon="plus" onPress={() => void pick()} style={{ alignSelf: "flex-start" }} />
          ) : (
            <Text style={[type.caption, { color: t.text3 }]}>Updating works in the web app for now.</Text>
          )}
        </>
      ) : (
        <>
          <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>From {file || "your YNAB export"}</Text>
          {nothing ? <Text style={[type.body, { color: t.text2 }]}>Nothing new since {dayText(lastSync)}.</Text> : null}
          <View>
            {fresh ? row(fresh, "New or changed in YNAB", "They come in like any transaction.") : null}
            {u.history ? row(u.history, `Old transactions from ${n(closed.length, "closed account")}`, "History only: you see them in Activity, and they never count in your budget. No accounts are added.", { key: "closed", list: closed }) : null}
            {u.replaced.length ? row(u.replaced.length, "Of yours match YNAB's", "The same transaction you added here: YNAB's copy replaces yours.") : null}
            {u.keptEdited.length ? row(u.keptEdited.length, "Gone from YNAB, but you changed them here", "They stay, as yours.") : null}
            {u.hiddenAdded.length ? row(u.hiddenAdded.length, `New ${u.hiddenAdded.length === 1 ? "category" : "categories"}, archived`, "Bring one back from Archived at the bottom of Budget.", { key: "cats", list: u.hiddenAdded.map((b) => b.name) }) : null}
            {rest.length ? row(rest.length, "Accounts not in your budget", "Investments, loans and others you left out: nothing from them comes in.", { key: "rest", list: rest }) : null}
          </View>
          {u.gone.length ? (
            <ToggleRow
              label={`Remove ${n(u.gone.length, "transaction")} gone from YNAB`}
              hint="Deleted in YNAB, or changed there (the changed version comes in above, so leave this on to avoid having both). Off: they stay here."
              value={removeGone}
              onChange={setRemoveGone}
            />
          ) : null}
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            {nothing ? null : <Button title="Update" tone="primary" onPress={apply} />}
            <Button title={nothing ? "Done" : "Cancel"} tone="ghost" onPress={() => setU(null)} />
          </View>
        </>
      )}
      {error ? <Text role="alert" style={[type.label, { color: t.bad }]}>{error}</Text> : null}
      {done ? <Text role="status" style={[type.label, { color: t.good }]}>{done}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  count: { minWidth: 52, textAlign: "right", fontWeight: "700", fontVariant: ["tabular-nums"] },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, paddingTop: space.xs },
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, overflow: "hidden" },
});
