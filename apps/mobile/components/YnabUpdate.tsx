/**
 * After the import: bring in a newer YNAB export's transactions (for using both apps side by side for a
 * while). Shows what would change first; categories, amounts, groups and accounts stay as they are.
 */
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { Button, ToggleRow } from "./form";
import { Card } from "./ui";
import { dayText } from "./ImportUndo";
import { usePlan } from "../lib/plan";
import { monthKey, useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { pickYnabFiles } from "../lib/ynabFiles";
import { planYnabUpdate, type YnabUpdate } from "../lib/ynabUpdate";

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
    setDone(`Updated: ${n(u.add.length, "transaction")} in${out ? `, ${out} removed` : ""}.`);
    setU(null);
  };

  const line = (text: string, color = t.text) => <Text style={[type.body, { color }]}>{text}</Text>;
  const nothing = u && !u.add.length && !u.gone.length && !u.replaced.length;
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
          {nothing ? line(`Nothing new since ${dayText(lastSync)}.`, t.text2) : null}
          {u.add.length - u.history ? line(`${n(u.add.length - u.history, "transaction")} new or changed in YNAB come in.`) : null}
          {u.history ? line(`${n(u.history, "older transaction")} from closed accounts come in as history: in Activity, never in your budget.`) : null}
          {u.replaced.length ? line(`${n(u.replaced.length, "of yours", "of yours")} ${u.replaced.length === 1 ? "is" : "are"} the same as YNAB's: YNAB's replace${u.replaced.length === 1 ? "s it" : " them"}.`) : null}
          {u.gone.length ? (
            <ToggleRow
              label={`Remove ${n(u.gone.length, "transaction")} gone from YNAB`}
              hint="Deleted or changed in YNAB since (a changed one also comes in as new above). Off: they stay here."
              value={removeGone}
              onChange={setRemoveGone}
            />
          ) : null}
          {u.keptEdited.length ? line(`${n(u.keptEdited.length, "transaction")} gone from YNAB that you changed here stay${u.keptEdited.length === 1 ? "s" : ""}, as yours.`, t.text2) : null}
          {u.hiddenAdded.length ? line(`New in YNAB, coming in archived: ${u.hiddenAdded.map((b) => b.name).join(", ")}.`, t.text2) : null}
          {u.skippedAccounts.length ? (
            <Text style={[type.caption, { color: t.text3 }]}>Not in your budget, so not added: {u.skippedAccounts.join(", ")}.</Text>
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
