/**
 * Sync, out of the way: nothing while it just works. On phones, a small note floating over the top of
 * the page (it never pushes the page down) while a big job runs, when this device can't reach your
 * account, or when a sync failed. Only once it lasts: a quick save or a blip in the signal shows
 * nothing. On a wide screen the sidebar's sync line says all of this instead (one place, not two).
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsWide } from "../lib/layout";
import { syncNow, useSync } from "../lib/sync";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button } from "./form";
import { Icon } from "./Icon";

/** How long each has to last before it shows (ms). */
const WAIT = { progress: 1000, offline: 4000, error: 1500 };

/** `key` once it has stayed the same for `ms` (undefined until then, and as soon as it's gone). */
export function useLasting<K extends string>(key: K | undefined, ms: number): K | undefined {
  const [shown, setShown] = useState<K | undefined>(undefined);
  useEffect(() => {
    if (!key) {
      setShown(undefined);
      return;
    }
    const id = setTimeout(() => setShown(key), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return key && shown === key ? key : undefined;
}

/** What the sync note should say, if anything (shared by the phone note and the sidebar line). */
export function useSyncNote(): "progress" | "offline" | "error" | undefined {
  const { status, progress } = useSync();
  const signedIn = status !== "off" && status !== "signedOut";
  const now = !signedIn ? undefined : progress ? "progress" : status === "offline" ? "offline" : status === "error" ? "error" : undefined;
  return useLasting(now, now ? WAIT[now] : 0);
}

export function SyncBanner() {
  const t = useTheme();
  const top = useSafeAreaInsets().top;
  const wide = useIsWide();
  const { progress, error } = useSync();
  const note = useSyncNote();
  if (wide || !note) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: top + space.xs }]}>
      <View
        role={note === "error" ? "alert" : "status"}
        style={[styles.pill, { backgroundColor: note === "error" ? t.badSoft : t.surface, borderColor: t.border, shadowColor: t.shadow }]}
      >
        {note === "progress" ? <ActivityIndicator size="small" color={t.accent} /> : <Icon name="info" size={16} color={note === "error" ? t.bad : t.text2} />}
        <Text style={[type.caption, { color: note === "error" ? t.text : t.text2, flexShrink: 1 }]} numberOfLines={2}>
          {note === "progress"
            ? progress
            : note === "offline"
              ? "Offline. Changes are saved here and sync when you're back."
              : `Couldn't sync${error ? `: ${error}` : ""}. Your changes are safe here.`}
        </Text>
        {note === "error" ? <Button title="Retry" onPress={() => void syncNow()} style={{ minHeight: 32 }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, zIndex: 50, alignItems: "center", paddingHorizontal: space.md },
  pill: {
    flexDirection: "row", alignItems: "center", gap: space.sm, maxWidth: 520,
    paddingVertical: space.xs, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 3,
  },
});
