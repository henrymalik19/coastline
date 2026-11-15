import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useAppearance } from "../lib/appearance";
import { syncConfigured } from "../lib/supabase";
import { useSync } from "../lib/sync";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton } from "./form";
import { Icon } from "./Icon";

const DAY = 86_400_000;

/**
 * Home, while you're not signed in: your plan lives only in this browser or app, so clearing it loses
 * everything. Suggest saving it to an account. Hide it and it stays away for 30 days.
 */
export function SaveNudge() {
  const t = useTheme();
  const router = useRouter();
  const email = useSync((s) => s.email);
  const hiddenAt = useAppearance((s) => s.saveNudgeHiddenAt);
  const hide = useAppearance((s) => s.hideSaveNudge);
  if (!syncConfigured || email) return null;
  if (hiddenAt && Date.now() - Date.parse(hiddenAt) < 30 * DAY) return null;
  return (
    <View style={[styles.box, { backgroundColor: t.accentSoft }]} role="note">
      <Icon name="lock" size={20} color={t.accent} />
      <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
        <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Save your plan to an account</Text>
        <Text style={[type.caption, { color: t.text2 }]}>
          Right now it's only on this device, so clearing your browser or losing your phone would lose it. An account keeps it safe and on every
          device. No password: we email you a code.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button title="Save my plan" tone="primary" onPress={() => router.push("/settings/account")} />
        <IconButton icon="close" label="Hide for now" onPress={hide} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, flexWrap: "wrap" },
  actions: { flexDirection: "row", alignItems: "center", gap: space.xs },
});
