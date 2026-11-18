/**
 * Add categories (or a group, or sub categories) in one small dialog: just names and where each goes.
 * Amounts and everything else are set on the category afterwards. Several at once with "Add another".
 */
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { radius, space, type, useTheme } from "../lib/theme";
import { Icon } from "./Icon";
import { Button, Select } from "./form";

/** Where a new category goes: "group:<name>" (in a group) or "under:<id>" (a sub category of that one). */
export type AddLine = { name: string; to: string };
export type AddRequest =
  /** A new group, with its first categories. */
  | { kind: "group" }
  /** New categories; `to` is where the first line goes. */
  | { kind: "category"; to: string };

export function AddCategories({
  request, groups, parents, onClose, onSave,
}: {
  request: AddRequest | null;
  groups: string[];
  /** Categories that can have sub categories. */
  parents: { id: string; name: string; group: string }[];
  onClose: () => void;
  onSave: (r: { group?: string; lines: AddLine[] }) => void;
}) {
  const t = useTheme();
  const [group, setGroup] = useState("");
  const [lines, setLines] = useState<AddLine[]>([]);
  useEffect(() => {
    if (!request) return;
    setGroup("");
    setLines([{ name: "", to: request.kind === "category" ? request.to : "" }]);
  }, [request]);
  // Escape closes, as a dialog should
  useEffect(() => {
    if (!request || Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);
  if (!request) return null;
  const isGroup = request.kind === "group";
  const named = lines.filter((l) => l.name.trim());
  const ready = isGroup ? !!group.trim() && named.length > 0 : named.length > 0;
  const toOptions = [
    ...groups.map((g) => ({ value: "group:" + g, label: g, section: "In a group" })),
    ...parents.map((p) => ({ value: "under:" + p.id, label: `Under ${p.name || "Unnamed"}`, hint: p.group, section: "As a sub category" })),
  ];
  const setLine = (i: number, patch: Partial<AddLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const input = (value: string, onChange: (v: string) => void, label: string, placeholder: string, autoFocus?: boolean) => (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={t.text3}
      autoFocus={autoFocus}
      style={[type.body, styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
    />
  );
  const save = () => {
    if (!ready) return;
    onSave({ ...(isGroup ? { group: group.trim() } : {}), lines: named.map((l) => ({ name: l.name.trim(), to: isGroup ? "group:" + group.trim() : l.to })) });
    onClose();
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cancel">
        <Pressable onPress={() => {}} role="dialog" aria-label={isGroup ? "Add a group" : "Add categories"} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[type.heading, { color: t.text }]}>{isGroup ? "Add a group" : "Add categories"}</Text>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
            {isGroup ? (
              <View style={{ gap: 4 }}>
                <Text style={[type.caption, { color: t.text3 }]}>Group name</Text>
                {input(group, setGroup, "Group name", "e.g. Home expenses", true)}
              </View>
            ) : null}
            {isGroup ? <Text style={[type.caption, { color: t.text3 }]}>Its categories</Text> : null}
            {lines.map((l, i) => (
              <View key={i} style={{ gap: 4 }}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>{input(l.name, (v) => setLine(i, { name: v }), `Category ${i + 1} name`, i === 0 ? "e.g. Childcare" : "Another one", !isGroup && i === lines.length - 1)}</View>
                  {lines.length > 1 ? (
                    <Pressable role="button" accessibilityLabel={`Remove line ${i + 1}`} hitSlop={8} onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Icon name="close" size={16} color={t.text3} />
                    </Pressable>
                  ) : null}
                </View>
                {isGroup ? null : (
                  <View style={[styles.row, { justifyContent: "space-between" }]}>
                    <Text style={[type.caption, { color: t.text3 }]}>Goes</Text>
                    <Select plain label={`Category ${i + 1}: goes`} value={l.to} options={toOptions} onChange={(v) => setLine(i, { to: v })} />
                  </View>
                )}
              </View>
            ))}
            <Pressable role="button" hitSlop={6} onPress={() => setLines((ls) => [...ls, { name: "", to: ls.at(-1)?.to ?? "" }])} style={[styles.row, { alignSelf: "flex-start" }]}>
              <Icon name="plus" size={14} color={t.accent} />
              <Text style={[type.label, { color: t.accent, fontWeight: "700" }]}>Add another</Text>
            </Pressable>
          </ScrollView>
          <Text style={[type.caption, { color: t.text3 }]}>Set amounts and the rest on each one afterwards.</Text>
          <View style={[styles.row, { justifyContent: "flex-end" }]}>
            <Button title="Cancel" tone="ghost" onPress={onClose} style={{ minHeight: 44 }} />
            <Button title={named.length > 1 ? `Add ${named.length}` : "Add"} tone="primary" disabled={!ready} onPress={save} style={{ minHeight: 44 }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: space.md },
  card: { width: "100%", maxWidth: 440, borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 44 },
});
