/** Phones: the drag grips stay hidden until you tap Reorder (Done hides them again). */
import { Pressable, Text } from "react-native";
import { Icon } from "./Icon";
import { type, useTheme } from "../lib/theme";

export function ReorderToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable
      role="button"
      aria-pressed={on}
      accessibilityLabel={on ? "Done reordering" : "Reorder categories"}
      onPress={() => onChange(!on)}
      hitSlop={8}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2, opacity: pressed ? 0.6 : 1 }]}
    >
      {on ? null : <Icon name="grip" size={12} color={t.accent} />}
      <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{on ? "Done" : "Reorder"}</Text>
    </Pressable>
  );
}
