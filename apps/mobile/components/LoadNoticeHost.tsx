/**
 * Something in this device's saved copy couldn't be read when the app opened (lib/store.ts, lib/salvage.ts):
 * say what happened, once. Mounted once, at the root.
 */
import { useSyncExternalStore } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "../lib/store";
import { useSync } from "../lib/sync";
import { saveHealth } from "../lib/txnStorage";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button } from "./form";

export function LoadNoticeHost() {
  const t = useTheme();
  const notice = useStore((s) => s.loadNotice);
  if (!notice) return null;
  const close = () => {
    useStore.setState({ loadNotice: undefined });
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View role="alertdialog" aria-label="Some saved data couldn't be read" style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[type.heading, { color: t.text }]}>Some saved data couldn't be read</Text>
          <Text style={[type.body, { color: t.text2 }]}>{notice}</Text>
          <Button title="OK" tone="primary" onPress={close} style={{ alignSelf: "flex-end", minHeight: 44 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: space.md },
  card: { width: "100%", maxWidth: 420, borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  bar: { position: "absolute", left: 0, right: 0, zIndex: 50, borderBottomWidth: 1, paddingHorizontal: space.md, paddingVertical: space.sm, gap: 2 },
});

/**
 * Saving on this device is failing (storage full, private browsing; lib/txnStorage.ts saveHealth): said
 * at the top of every screen until a save works again, so changes are never lost without a word.
 */
export function SaveProblemBar() {
  const t = useTheme();
  const problem = useSyncExternalStore(saveHealth.subscribe, saveHealth.get, saveHealth.get);
  const synced = useSync((s) => !!s.userId);
  const insets = useSafeAreaInsets();
  if (!problem) return null;
  return (
    <View role="alert" style={[styles.bar, { top: insets.top, backgroundColor: t.badSoft, borderColor: t.bad }]}>
      <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>
        {problem === "full" ? "This device is out of room: your latest changes aren't saved on it." : "Your latest changes couldn't be saved on this device."}
      </Text>
      <Text style={[type.caption, { color: t.text2 }]}>
        {synced ? "They're still going to your account. " : "Keep this tab open, and "}
        free up space, or download a backup (Settings → Backup & restore). It tries again with every change.
      </Text>
    </View>
  );
}
