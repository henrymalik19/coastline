/**
 * Your import from YNAB: when it happened, and Undo while it's still possible (a countdown on the
 * button). Shown on the import screen, in Settings → Backup & restore, and as a reminder on the
 * Budget near the end of the window.
 */
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./form";
import { Card } from "./ui";
import { canUndoImport, changedSinceImport, UNDO_DAYS } from "../lib/importUndo";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";

const DAY = 86_400_000;
export const dayText = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Days left to undo the import (0 when it can't be undone). */
export function useUndoDaysLeft(): number {
  const lastImport = useStore((s) => s.lastImport);
  const now = Date.now();
  return lastImport && canUndoImport(lastImport, now) ? Math.max(1, Math.ceil((lastImport.at + UNDO_DAYS * DAY - now) / DAY)) : 0;
}

export function ImportUndoCard({ children, onUndone, plain }: { children?: ReactNode; onUndone?: () => void; /** No card around it (inside another one). */ plain?: boolean }) {
  const t = useTheme();
  const lastImport = useStore((s) => s.lastImport);
  const importedAt = useStore((s) => s.importedAt);
  const txns = useStore((s) => s.txns);
  const undoImport = useStore((s) => s.undoImport);
  const keepImport = useStore((s) => s.keepImport);
  const [ask, setAsk] = useState(false);
  const left = useUndoDaysLeft();
  if (!importedAt) return null;
  const changed = lastImport ? changedSinceImport(txns, lastImport) : 0;
  const body = (
    <View style={{ gap: space.sm }}>
      <Text style={[type.heading, { color: t.text }]}>Imported from YNAB on {dayText(importedAt)}</Text>
      {children}
      {left && lastImport ? (
        <>
          <Text style={[type.body, { color: t.text2 }]}>
            Not what you expected? Undo puts your budget and transactions back to how they were just before, and you can import again. You can undo until{" "}
            <Text style={{ color: t.text, fontWeight: "700" }}>{dayText(lastImport.at + UNDO_DAYS * DAY)}</Text>.
          </Text>
          {ask ? (
            <View style={[styles.ask, { borderColor: t.bad }]}>
              <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Undo the import?</Text>
              <Text style={[type.caption, { color: t.text2 }]}>
                Everything it brought in is removed, on your other devices too.
                {changed ? ` This also throws away the ${changed} transaction${changed === 1 ? "" : "s"} you added or changed since, and any budget changes.` : " Any budget changes you made since go too."}
              </Text>
              <View style={[styles.row, { flexWrap: "wrap" }]}>
                <Button title="Yes, undo it" tone="danger" onPress={() => { undoImport(); setAsk(false); onUndone?.(); }} style={{ minHeight: 40 }} />
                <Button title="Cancel" tone="ghost" onPress={() => setAsk(false)} style={{ minHeight: 40 }} />
              </View>
            </View>
          ) : (
            <View style={[styles.row, { flexWrap: "wrap" }]}>
              <Button title={`Undo import · ${left} day${left === 1 ? "" : "s"} left`} onPress={() => setAsk(true)} />
              <Button title="Keep it" tone="ghost" onPress={keepImport} />
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
  const router = useRouter();
  const left = useUndoDaysLeft();
  const keepImport = useStore((s) => s.keepImport);
  if (!left || left > 7) return null;
  return (
    <View style={[styles.reminder, { backgroundColor: t.warnSoft }]}>
      <Text style={[type.caption, { color: t.text, flex: 1, minWidth: 180 }]}>
        <Text style={{ fontWeight: "700" }}>{left} day{left === 1 ? "" : "s"} left</Text> to undo your YNAB import. After that it stays as it is.
      </Text>
      <View style={styles.row}>
        <Pressable role="button" onPress={() => router.push("/money/import")} hitSlop={6}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Review</Text>
        </Pressable>
        <Pressable role="button" onPress={keepImport} hitSlop={6}>
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
