/**
 * Something in this device's saved copy couldn't be read when the app opened (lib/store.ts, lib/salvage.ts):
 * say what happened, once. Mounted once, at the root.
 */
import { Modal, StyleSheet, Text, View } from "react-native";
import { useStore } from "../lib/store";
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
});
