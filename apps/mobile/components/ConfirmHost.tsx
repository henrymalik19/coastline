/** The app's "are you sure?" dialog (lib/confirm.ts). Mounted once, at the root. */
import { useEffect } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { answerConfirm, useConfirm } from "../lib/confirm";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button } from "./form";

export function ConfirmHost() {
  const t = useTheme();
  const pending = useConfirm((s) => s.pending);
  // Escape cancels, as a dialog should
  useEffect(() => {
    if (!pending || Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") answerConfirm(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);
  if (!pending) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => answerConfirm(false)}>
      <Pressable style={styles.backdrop} onPress={() => answerConfirm(false)} accessibilityLabel="Cancel">
        <Pressable onPress={() => {}} role="alertdialog" aria-label={pending.title} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[type.heading, { color: t.text }]}>{pending.title}</Text>
          {pending.message ? <Text style={[type.body, { color: t.text2 }]}>{pending.message}</Text> : null}
          <View style={styles.row}>
            <Button title="Cancel" tone="ghost" onPress={() => answerConfirm(false)} style={{ minHeight: 44 }} />
            <Button title={pending.action} tone={/delete|remove|start over|start fresh/i.test(pending.action) ? "danger" : "primary"} onPress={() => answerConfirm(true)} style={{ minHeight: 44 }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: space.md },
  card: { width: "100%", maxWidth: 420, borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm, flexWrap: "wrap" },
});
