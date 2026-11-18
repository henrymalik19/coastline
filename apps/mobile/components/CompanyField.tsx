import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { companiesIn, othersWith, renameCompany, suggestCompanies } from "../lib/company";
import { confirm } from "../lib/confirm";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";

/**
 * The bank or company an account or debt is with ("Chase"). Suggests the ones you already use as you
 * type, and when you change one other accounts share, offers to change it on those too. Saved when
 * you finish typing (or pick a suggestion).
 */
export function CompanyField({ id, value, onChange, label = "Company" }: { id: string; value?: string; onChange: (v: string) => void; label?: string }) {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const [draft, setDraft] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  const input = useRef<{ blur: () => void } | null>(null);
  // a suggestion being tapped: leaving the field for it doesn't save the half-typed text
  const picking = useRef(false);
  useEffect(() => {
    if (!focused) setDraft(value ?? "");
  }, [value, focused]);
  const commit = async (next: string) => {
    const old = (value ?? "").trim();
    const v = next.trim();
    setDraft(v);
    if (v === old) return;
    const n = old ? othersWith(state, old, id) : 0;
    if (n && (await confirm(`Change ${old} to ${v || "no company"}?`, `${n} other ${n === 1 ? "account uses" : "accounts use"} ${old}. Change ${n === 1 ? "it" : "them"} too?`, "Change all"))) {
      update((p) => renameCompany(p, old, v));
      return;
    }
    onChange(v);
  };
  const picks = suggestCompanies(companiesIn(state), draft);
  return (
    <View style={{ gap: space.xs }}>
      <View style={[styles.input, { borderColor: focused ? t.accent : t.border, backgroundColor: t.surface2 }]}>
        <TextInput
          ref={input as never}
          accessibilityLabel={label}
          value={draft}
          placeholder="e.g. Chase (optional)"
          placeholderTextColor={t.text3}
          autoCorrect={false}
          onChangeText={setDraft}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (!picking.current) void commit(draft); }}
          // Enter just leaves the field: it's saved once, on the way out
          onSubmitEditing={() => input.current?.blur()}
          style={[type.body, styles.text, { color: t.text }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
        />
      </View>
      {picks.length ? (
        <View style={styles.chips}>
          {picks.map((c) => (
            <Pressable key={c} role="button" accessibilityLabel={`Use ${c}`} onPressIn={() => { picking.current = true; }} onPress={() => { picking.current = false; void commit(c); }} style={[styles.chip, { borderColor: t.border, backgroundColor: t.surface }]}>
              <Text style={[type.caption, { color: t.text2, fontWeight: "600" }]}>{c}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** "Chase · Sapphire" on one line, with the company lighter. */
export function NameWithCompany({ name, company, color, style }: { name: string; company?: string; color: string; style?: object }) {
  const t = useTheme();
  const c = company?.trim();
  return (
    <Text style={[type.body, { color }, style]} numberOfLines={1}>
      {c ? <Text style={{ color: t.text3 }}>{c} · </Text> : null}
      {name}
    </Text>
  );
}

const styles = StyleSheet.create({
  input: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, minHeight: 44 },
  text: { flex: 1, minWidth: 0, paddingVertical: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
});
