/**
 * Your import from YNAB: when it happened, and Undo while it's still possible (a countdown on the
 * button). Shown on the import screen, in Settings → Backup & restore, and as a reminder on the
 * Budget near the end of the window.
 */
import { useOpenPage } from "../lib/nav";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, ToggleRow } from "./form";
import { Card } from "./ui";
import { addedSinceImport, canUndoImport, UNDO_DAYS } from "../lib/importUndo";
import { useStore } from "../lib/store";
import { importWait } from "../lib/importWait";
import { useSync } from "../lib/sync";
import { radius, space, type, useTheme } from "../lib/theme";

const DAY = 86_400_000;
export const dayText = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Days left to undo the import (0 when it can't be undone). */
export function useUndoDaysLeft(): number {
  const lastImport = useStore((s) => s.lastImport);
  const now = Date.now();
  return lastImport && canUndoImport(lastImport, now) ? Math.max(1, Math.ceil((lastImport.at + UNDO_DAYS * DAY - now) / DAY)) : 0;
}

/**
 * Whether this budget came from a YNAB import: the import's record (synced), or, for one made before that
 * was synced, YNAB's transactions in it. Then there's no second import (undo it, or start over).
 */
export function useImported(): boolean {
  const importedAt = useStore((s) => s.importedAt);
  const fromYnab = useStore((s) => s.txns.some((x) => x.source === "ynab" && !x.deleted));
  return !!importedAt || fromYnab;
}

export function ImportUndoCard({ children, onUndone, plain }: { children?: ReactNode; onUndone?: () => void; /** No card around it (inside another one). */ plain?: boolean }) {
  const t = useTheme();
  const lastImport = useStore((s) => s.lastImport);
  const importedAt = useStore((s) => s.importedAt);
  const txns = useStore((s) => s.txns);
  const undoImport = useStore((s) => s.undoImport);
  // not while syncing: other devices could be left half-undone
  const wait = importWait(useSync());
  const keepImport = useStore((s) => s.keepImport);
  const [ask, setAsk] = useState<"undo" | "keep" | null>(null);
  // keep the transactions you added since (where their account was there before the import)
  const [keepAdded, setKeepAdded] = useState(true);
  const left = useUndoDaysLeft();
  const imported = useImported();
  if (!imported) return null;
  const added = lastImport ? addedSinceImport(txns, lastImport) : { keep: 0, remove: 0 };
  const addedAll = added.keep + added.remove;
  const body = (
    <View style={{ gap: space.sm }}>
      <Text style={[type.heading, { color: t.text }]}>{importedAt ? `Imported from YNAB on ${dayText(importedAt)}` : "Imported from YNAB"}</Text>
      {children}
      {left && lastImport ? (
        <>
          <Text style={[type.body, { color: t.text2 }]}>
            Not what you expected? Undo puts your budget and transactions back to how they were just before, and you can import again. You can undo until{" "}
            <Text style={{ color: t.text, fontWeight: "700" }}>{dayText(lastImport.at + UNDO_DAYS * DAY)}</Text>.
          </Text>
          {ask === "keep" ? (
            <View style={[styles.ask, { borderColor: t.border }]}>
              <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Keep the import as it is?</Text>
              <Text style={[type.caption, { color: t.text2 }]}>You won't be able to undo it after this. Your budget and transactions stay exactly as they are.</Text>
              <View style={[styles.row, { flexWrap: "wrap" }]}>
                <Button title="Yes, keep it" tone="primary" onPress={() => { keepImport(); setAsk(null); }} style={{ minHeight: 40 }} />
                <Button title="Cancel" tone="ghost" onPress={() => setAsk(null)} style={{ minHeight: 40 }} />
              </View>
            </View>
          ) : ask === "undo" ? (
            <View style={[styles.ask, { borderColor: t.bad }]}>
              <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Undo the import?</Text>
              <Text style={[type.caption, { color: t.text2 }]}>
                Everything it brought in is removed, on your other devices too, and your budget goes back to how it was (changes you made since go too).
              </Text>
              {addedAll ? (
                added.keep ? (
                  <ToggleRow
                    label={`Keep the ${added.keep} transaction${added.keep === 1 ? "" : "s"} you added since`}
                    hint={`They stay in your own accounts; one in a category the import made needs a category again.${added.remove ? ` ${added.remove} in accounts the import made can't stay.` : ""} Off: they're removed too.`}
                    value={keepAdded}
                    onChange={setKeepAdded}
                  />
                ) : (
                  <Text style={[type.caption, { color: t.text2 }]}>The {added.remove} transaction{added.remove === 1 ? "" : "s"} you added since {added.remove === 1 ? "is" : "are"} in accounts the import made, so {added.remove === 1 ? "it goes" : "they go"} too.</Text>
                )
              ) : null}
              <View style={[styles.row, { flexWrap: "wrap" }]}>
                <Button title="Yes, undo it" tone="danger" disabled={!!wait} onPress={() => { if (wait) return; undoImport(keepAdded); setAsk(null); onUndone?.(); }} style={{ minHeight: 40 }} />
                <Button title="Cancel" tone="ghost" onPress={() => setAsk(null)} style={{ minHeight: 40 }} />
              </View>
            </View>
          ) : (
            <View style={[styles.row, { flexWrap: "wrap" }]}>
              <Button title={`Undo import · ${left} day${left === 1 ? "" : "s"} left`} disabled={!!wait} onPress={() => setAsk("undo")} />
              <Button title="Keep it" tone="ghost" onPress={() => setAsk("keep")} />
              {wait ? <Text style={[type.caption, { color: t.text3 }]}>{wait}</Text> : null}
            </View>
          )}
        </>
      ) : (
        <Text style={[type.caption, { color: t.text3 }]}>
          It can't be undone anymore. To bring it in again, start over under Settings → Backup & restore; that clears your budget and transactions first.
        </Text>
      )}
    </View>
  );
  return plain ? body : <Card>{body}</Card>;
}

/** On the Budget, the last week you can undo: a reminder before the window closes. */
export function ImportUndoReminder() {
  const t = useTheme();
  const openPage = useOpenPage();
  const left = useUndoDaysLeft();
  const keepImport = useStore((s) => s.keepImport);
  const [sure, setSure] = useState(false);
  if (!left || left > 7) return null;
  if (sure) {
    return (
      <View style={[styles.reminder, { backgroundColor: t.warnSoft }]}>
        <Text style={[type.caption, { color: t.text, flex: 1, minWidth: 180 }]}>
          <Text style={{ fontWeight: "700" }}>Keep the import as it is?</Text> You won't be able to undo it after this.
        </Text>
        <View style={styles.row}>
          <Pressable role="button" onPress={keepImport} hitSlop={6}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Yes, keep it</Text>
          </Pressable>
          <Pressable role="button" onPress={() => setSure(false)} hitSlop={6}>
            <Text style={[type.caption, { color: t.text2, fontWeight: "700" }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.reminder, { backgroundColor: t.warnSoft }]}>
      <Text style={[type.caption, { color: t.text, flex: 1, minWidth: 180 }]}>
        <Text style={{ fontWeight: "700" }}>{left} day{left === 1 ? "" : "s"} left</Text> to undo your YNAB import. After that it stays as it is.
      </Text>
      <View style={styles.row}>
        <Pressable role="button" onPress={() => openPage("/money/import")} hitSlop={6}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Review</Text>
        </Pressable>
        <Pressable role="button" onPress={() => setSure(true)} hitSlop={6}>
          <Text style={[type.caption, { color: t.text2, fontWeight: "700" }]}>Keep it</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  ask: { borderWidth: 1, borderRadius: 10, padding: space.md, gap: space.sm },
  reminder: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
});
