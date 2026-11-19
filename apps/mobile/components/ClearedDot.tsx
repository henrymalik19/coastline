/**
 * Where a transaction stands with your bank: an empty ring (not at your bank yet), a check (cleared:
 * it's shown up there), or a lock (reconciled: matched to a statement, so it's locked). Tap to clear
 * or unclear; hover (or long-press) for what it means. History (from a closed account) gets a clock
 * instead: there to look back at, nothing to clear.
 */
import type { Txn } from "@coastfi/engine";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { radius, type, useTheme } from "../lib/theme";
import { Icon } from "./Icon";

const HISTORY = "History from a closed account: there to look back at. It never counts in your budget";
const MEANING: Record<Txn["cleared"], string> = {
  uncleared: "Not at your bank yet. Tap when it shows up there",
  cleared: "Cleared: it's shown up at your bank. Tap to undo",
  reconciled: "Reconciled: matched to your bank statement, so it's locked",
};

export function ClearedDot({ status, onToggle, history }: { status: Txn["cleared"]; onToggle: () => void; history?: boolean }) {
  const t = useTheme();
  const [tip, setTip] = useState(false);
  const locked = status === "reconciled" || !!history;
  const meaning = history ? HISTORY : MEANING[status];
  return (
    <View style={styles.wrap}>
      <Pressable
        role="checkbox"
        aria-checked={status !== "uncleared"}
        accessibilityLabel={meaning}
        disabled={locked && Platform.OS !== "web"}
        onPress={locked ? () => setTip((v) => !v) : onToggle}
        onLongPress={() => setTip(true)}
        onHoverIn={() => setTip(true)}
        onHoverOut={() => setTip(false)}
        hitSlop={8}
        style={[
          styles.dot,
          {
            borderColor: history ? t.border : status === "uncleared" ? t.border : t.good,
            backgroundColor: history ? t.surface2 : locked ? t.good : status === "cleared" ? t.goodSoft : "transparent",
          },
        ]}
      >
        {history ? <Icon name="history" size={13} color={t.text3} /> : status === "cleared" ? <Icon name="check" size={12} color={t.good} /> : locked ? <Icon name="lock" size={11} color="#fff" /> : null}
      </Pressable>
      {tip ? (
        <View pointerEvents="none" style={[styles.tip, { backgroundColor: t.text, shadowColor: "#000" }]}>
          <Text style={[type.caption, { color: t.bg }]}>{meaning}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", zIndex: 5 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tip: { position: "absolute", left: 30, top: -4, width: 220, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
});
