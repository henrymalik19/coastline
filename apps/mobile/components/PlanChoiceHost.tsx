/**
 * Signed in on a device that already has a plan of its own, to an account that has a different one:
 * ask whose plan to keep, instead of letting the newer one win (a setup just made here is always newer
 * than your real plan). Nothing uploads until this is answered. Mounted once, at the root.
 */
import { useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { confirm } from "../lib/confirm";
import { choosePlan, useSync } from "../lib/sync";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button } from "./form";

export function PlanChoiceHost() {
  const t = useTheme();
  const pending = useSync((s) => s.planChoice);
  const [busy, setBusy] = useState(false);
  if (!pending) return null;

  const pick = async (keep: "account" | "device") => {
    if (keep === "device" && !(await confirm("Replace your account's plan?", "Your account's plan is replaced with this device's, on every device you sign in on. This can't be undone. Your transactions and check-ins are kept.", "Replace it"))) return;
    setBusy(true);
    try {
      await choosePlan(keep);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View role="alertdialog" aria-label="Which plan do you want to keep?" style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[type.heading, { color: t.text }]}>Which plan do you want to keep?</Text>
          <Text style={[type.body, { color: t.text2 }]}>
            This device has a plan you set up here, and your account already has a different one. Your transactions and check-ins from both are kept either way.
          </Text>
          <View style={{ gap: space.xs }}>
            <Button title="Use my account's plan" tone="primary" disabled={busy} onPress={() => void pick("account")} />
            <Text style={[type.caption, { color: t.text3 }]}>Loads your saved plan here. The setup on this device is replaced.</Text>
          </View>
          <View style={{ gap: space.xs }}>
            <Button title="Keep this device's plan" tone="ghost" disabled={busy} onPress={() => void pick("device")} />
            <Text style={[type.caption, { color: t.text3 }]}>Replaces the plan in your account with this one.</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: space.md },
  card: { width: "100%", maxWidth: 420, borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
});
