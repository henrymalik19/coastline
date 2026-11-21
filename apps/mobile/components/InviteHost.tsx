/**
 * Someone shared their plan with you: say who, and Accept or Decline. Signing in never joins a plan on
 * its own (anyone can invite any email). Shown over whatever page you're on; "Later" hides it until the
 * app opens again. Mounted once, at the root.
 */
import { useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { acceptInvite, declineInvite, useInvites, useMembership } from "../lib/sharing";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button } from "./form";

export function InviteHost() {
  const t = useTheme();
  const { invites, busy, error } = useInvites();
  const member = useMembership((s) => s.status);
  const [later, setLater] = useState<string[]>([]);
  const inv = invites.find((i) => !later.includes(i.planId));
  if (!inv) return null;
  const from = inv.from ?? "Someone";
  const inOther = member === "full" || member === "member";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setLater((l) => [...l, inv.planId])}>
      <View style={styles.backdrop}>
        <View role="alertdialog" aria-label={`Invite from ${from}`} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[type.heading, { color: t.text }]}>{from} invited you</Text>
          <Text style={[type.body, { color: t.text2 }]}>
            {inv.role === "full"
              ? `Join ${from}'s plan to share their whole budget and plan: you both see and change the same things. Your own plan stays in your account, and you can leave any time.`
              : `Add purchases on the cards ${from} picked, and see what's left in each category this month. Your own plan doesn't change.`}
          </Text>
          <Text style={[type.caption, { color: t.text3 }]}>Only accept if you know {from}. If you don't, decline it.</Text>
          {inOther ? <Text style={[type.caption, { color: t.warn }]}>You share another plan now. Leave it first (Settings → Sharing) to join this one.</Text> : null}
          {error ? <Text role="alert" style={[type.caption, { color: t.bad }]}>{error}</Text> : null}
          <View style={styles.row}>
            <Button title="Later" tone="ghost" disabled={busy} onPress={() => setLater((l) => [...l, inv.planId])} style={{ minHeight: 44 }} />
            <Button title="Decline" tone="ghost" disabled={busy} onPress={() => void declineInvite(inv.planId)} style={{ minHeight: 44 }} />
            <Button title={busy ? "Joining…" : "Accept"} tone="primary" disabled={busy || inOther} onPress={() => void acceptInvite(inv.planId)} style={{ minHeight: 44 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: space.md },
  card: { width: "100%", maxWidth: 420, borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm, flexWrap: "wrap" },
});
