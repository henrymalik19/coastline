/**
 * Sync, out of the way: nothing while it just works. A line while a big job runs (loading or saving
 * thousands of transactions), and a note when this device can't reach your account.
 */
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { syncNow, useSync } from "../lib/sync";
import { space, type, useTheme } from "../lib/theme";
import { Button } from "./form";
import { Icon } from "./Icon";

export function SyncBanner() {
  const t = useTheme();
  const top = useSafeAreaInsets().top;
  const { status, progress, error } = useSync();
  const signedIn = status !== "off" && status !== "signedOut";
  if (!signedIn) return null;
  if (progress)
    return (
      <View role="status" style={[styles.bar, { paddingTop: top + space.xs, backgroundColor: t.surface2, borderColor: t.border }]}>
        <ActivityIndicator size="small" color={t.accent} />
        <Text style={[type.caption, { color: t.text2, flex: 1 }]} numberOfLines={1}>{progress}</Text>
      </View>
    );
  if (status === "offline")
    return (
      <View role="status" style={[styles.bar, { paddingTop: top + space.xs, backgroundColor: t.surface2, borderColor: t.border }]}>
        <Icon name="info" size={16} color={t.text2} />
        <Text style={[type.caption, { color: t.text2, flex: 1 }]}>Offline. Changes are saved on this device and sync when you're back online.</Text>
      </View>
    );
  if (status === "error")
    return (
      <View role="alert" style={[styles.bar, { paddingTop: top + space.xs, backgroundColor: t.badSoft, borderColor: t.border }]}>
        <Icon name="info" size={16} color={t.bad} />
        <Text style={[type.caption, { color: t.text, flex: 1 }]} numberOfLines={2}>
          Couldn't sync{error ? `: ${error}` : ""}. Your changes are safe on this device.
        </Text>
        <Button title="Retry" onPress={() => void syncNow()} style={{ minHeight: 32 }} />
      </View>
    );
  return null;
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
});
