/**
 * After the import: bring in a newer YNAB export's transactions (for using both apps side by side for a
 * while). Shows what would change first; categories, amounts, groups and accounts stay as they are.
 */
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, ToggleRow } from "./form";
import { Card } from "./ui";
import { BackupFirst } from "./BackupFirst";
import { dayText } from "./ImportUndo";
import { usePlan } from "../lib/plan";
import { confirm } from "../lib/confirm";
import { fullName } from "../lib/company";
import { monthKey, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { pickYnabFiles } from "../lib/ynabFiles";
import { canUndoUpdate, planYnabUpdate, type YnabUpdate } from "../lib/ynabUpdate";
import { OUTSIDE } from "../lib/outside";
import { isHistoryTxn } from "@coastfi/engine";

type Open = "closed" | "cats" | "rest";
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;

export function YnabUpdateCard({ plain }: { /** No card around it (inside another one). */ plain?: boolean } = {}) {
  const t = useTheme();
  const { start } = usePlan();
  const plan = useStore((s) => s.plan);
  const txns = useStore((s) => s.txns);
  const lastSync = useStore((s) => s.ynabSyncedAt ?? s.importedAt ?? 0);
  const updateFromYnab = useStore((s) => s.updateFromYnab);
  const saved = useStore((s) => s.lastUpdate);
  // one past its 30 days can't be undone any more (it's dropped when the app next opens)
  const lastUpdate = canUndoUpdate(saved, Date.now()) ? saved : undefined;
  const lastUndo = useStore((s) => s.lastUndo);
  const undoUpdate = useStore((s) => s.undoYnabUpdate);
  const nameOf = (id: string) => { const a = plan.accounts.find((x) => x.id === id) ?? plan.debts.find((x) => x.id === id); return a ? fullName(a) : "An account"; };
  const undo = async () => {
    if (!lastUpdate) return;
    const changed = lastUpdate.before.length + lastUpdate.added.length;
    if (!(await confirm("Undo the last update?", `The ${changed.toLocaleString()} transactions it changed or brought in go back to how they were. Any you've changed since stay as you left them.`, "Undo update"))) return;
    const kept = undoUpdate();
    setDone("");
    setUndone(kept ? `Undone. ${kept.toLocaleString()} you'd changed since the update stayed as you left them.` : "Undone: your transactions are back to how they were before the update.");
  };
  const [undone, setUndone] = useState("");
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
      setUndone("");
      setU(planYnabUpdate(plan, got.data, txns, lastSync, monthKey(start), undefined, lastUndo));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };
  const apply = () => {
    if (!u) return;
    updateFromYnab(u, removeGone);
    const out = (removeGone ? u.gone.length : 0) + u.replaced.length;
    setDone(`Updated: ${n(u.add.length - u.history, "transaction")} in${u.changed.length + u.changedBoth.length ? `, ${(u.changed.length + u.changedBoth.length).toLocaleString()} changed` : ""}${u.history ? `, ${u.history.toLocaleString()} as history` : ""}${out ? `, ${out} removed` : ""}.`);
    setU(null);
  };

  const nothing = u && !u.add.length && !u.changed.length && !u.changedBoth.length && !u.gone.length && !u.replaced.length;
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

  const Wrap = plain ? View : Card;
  return (
    <Wrap style={{ gap: space.sm }}>
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
            {fresh ? row(fresh, "New in YNAB", "They come in like any transaction.") : null}
            {u.changed.length ? row(u.changed.length, "Changed in YNAB", "A new category, memo or amount: updated here to match.") : null}
            {u.changedBoth.length ? row(u.changedBoth.length, "Changed in both apps", "Your version here stays. YNAB only fills in a category or memo you left blank.") : null}
            {u.history ? row(u.history, `Old transactions from ${n(closed.length, "closed account")}`, "History only: you see them in Activity, and they never count in your budget. No accounts are added.", { key: "closed", list: closed }) : null}
            {u.replaced.length ? row(u.replaced.length, "Of yours match YNAB's", "The same transaction you added here: YNAB's copy replaces yours.") : null}
            {u.keptEdited.length ? row(u.keptEdited.length, "Gone from YNAB, but you changed them here", "They stay, as yours.") : null}
            {u.hiddenAdded.length ? row(u.hiddenAdded.length, `New ${u.hiddenAdded.length === 1 ? "category" : "categories"}, archived`, "Bring one back from Archived at the bottom of Budget.", { key: "cats", list: u.hiddenAdded.map((b) => b.name) }) : null}
            {rest.length ? row(rest.length, "Accounts not in your budget", "Investments, loans and others you left out: nothing from them comes in.", { key: "rest", list: rest }) : null}
          </View>
          {u.gone.length ? (
            <ToggleRow
              label={`Remove ${n(u.gone.length, "transaction")} gone from YNAB`}
              hint="Deleted in YNAB (or the payee or date changed there, which comes in above as new). Off: they stay here."
              value={removeGone}
              onChange={setRemoveGone}
            />
          ) : null}
          {u.warnings.length ? (
            // a lot changing in one account: often the wrong YNAB account matched to it
            <View role="alert" style={[styles.warn, { borderColor: t.warn, backgroundColor: t.warnSoft }]}>
              <Text style={[type.body, { color: t.text, fontWeight: "700" }]}>Check this before updating</Text>
              {u.warnings.map((w) => (
                <Text key={w.accountId} style={[type.caption, { color: t.text }]}>
                  <Text style={{ fontWeight: "700" }}>{nameOf(w.accountId)}</Text> (matched to YNAB's “{w.ynab}”) would{w.gone ? ` lose ${n(w.gone, "transaction")}` : ""}{w.gone && w.older ? " and" : ""}{w.older ? ` get ${n(w.older, "transaction")} older than any it has` : ""}.
                </Text>
              ))}
              <Text style={[type.caption, { color: t.text2 }]}>That usually means the wrong YNAB account. If it looks wrong, cancel and send a diagnostic report. You can also undo an update afterwards.</Text>
            </View>
          ) : null}
          {nothing ? null : <BackupFirst />}
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            {nothing ? null : <Button title={u.warnings.length ? "Update anyway" : "Update"} tone="primary" onPress={apply} />}
            <Button title={nothing ? "Done" : "Cancel"} tone="ghost" onPress={() => setU(null)} />
          </View>
        </>
      )}
      {error ? <Text role="alert" style={[type.label, { color: t.bad }]}>{error}</Text> : null}
      {done ? <Text role="status" style={[type.label, { color: t.good }]}>{done}</Text> : null}
      {undone ? <Text role="status" style={[type.label, { color: t.good }]}>{undone}</Text> : null}
      {!u && lastUpdate ? (
        // the last update can be undone (on this device) for 30 days, until the next one or another device updates
        <View style={[styles.undo, { borderTopColor: t.border }]}>
          <Text style={[type.caption, { color: t.text2, flex: 1, minWidth: 180 }]}>
            Last update {dayText(lastUpdate.at)}: {n(lastUpdate.before.length, "changed", "changed")}, {lastUpdate.added.length.toLocaleString()} brought in. Not right? Undo it.
          </Text>
          <Button title="Undo update" tone="ghost" onPress={() => void undo()} style={{ minHeight: 36 }} />
        </View>
      ) : null}
    </Wrap>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  count: { minWidth: 52, textAlign: "right", fontWeight: "700", fontVariant: ["tabular-nums"] },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, paddingTop: space.xs },
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, overflow: "hidden" },
  warn: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs },
  undo: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
});
