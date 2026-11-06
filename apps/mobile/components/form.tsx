import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Switch, Text, TextInput, View, type ViewStyle } from "react-native";
import { radius, space, type, useTheme } from "../lib/theme";
import { Icon, type IconName } from "./Icon";

/* ---------- number input ---------- */

export type NumberKind = "money" | "percent" | "int" | "decimal";

const toText = (v: number, kind: NumberKind) => {
  if (!Number.isFinite(v)) return "";
  if (kind === "percent") return String(+(v * 100).toFixed(3));
  if (kind === "money") return String(+v.toFixed(2));
  return String(v);
};
const fromText = (s: string, kind: NumberKind) => {
  const n = Number(s.replace(/[$,%\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  if (kind === "percent") return n / 100;
  if (kind === "int") return Math.round(n);
  return n;
};

/**
 * Numeric input that keeps what you type while editing (so "1." or "" don't jump),
 * stores clean numbers, and shows $ / % adornments. Percent is stored as a decimal.
 */
export function NumberInput({
  value, onChange, kind = "decimal", label, width = 140, min, max,
}: { value: number; onChange: (v: number) => void; kind?: NumberKind; label: string; width?: number | "100%"; min?: number; max?: number }) {
  const t = useTheme();
  const [text, setText] = useState(toText(value, kind));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(toText(value, kind));
  }, [value, kind, focused]);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <View style={[styles.input, { width, borderColor: focused ? t.accent : t.border, backgroundColor: t.surface2 }]}>
      {kind === "money" ? <Text style={[type.body, { color: t.text3 }]}>$</Text> : null}
      <TextInput
        accessibilityLabel={label}
        value={text}
        onChangeText={(s) => {
          setText(s);
          const n = fromText(s, kind);
          if (n !== null && s.trim() !== "" && s.trim() !== "-") onChange(clamp(n));
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = fromText(text, kind);
          if (n === null || text.trim() === "") onChange(clamp(0));
        }}
        keyboardType={kind === "int" ? "number-pad" : "decimal-pad"}
        inputMode="decimal"
        selectTextOnFocus
        style={[type.body, styles.inputText, { color: t.text, textAlign: "right" }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
      />
      {kind === "percent" ? <Text style={[type.body, { color: t.text3 }]}>%</Text> : null}
    </View>
  );
}

export function TextField({
  value, onChange, label, placeholder, width = "100%",
}: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; width?: number | "100%" }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.input, { width, borderColor: focused ? t.accent : t.border, backgroundColor: t.surface2 }]}>
      <TextInput
        accessibilityLabel={label}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={t.text3}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[type.body, styles.inputText, { color: t.text }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
      />
    </View>
  );
}

/* ---------- rows ---------- */

/** A settings row: label (and hint) on the left, control on the right. */
export function FieldRow({ label, hint, children, stacked }: { label: string; hint?: string; children: ReactNode; stacked?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.row, stacked ? { flexDirection: "column", alignItems: "stretch" } : null]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: t.text }]}>{label}</Text>
        {hint ? <Text style={[type.caption, { color: t.text3 }]}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** On/off switch with theme colors on every platform. */
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onChange}
      trackColor={{ true: t.accent, false: t.track }}
      thumbColor="#fff"
      {...(Platform.OS === "web" ? ({ activeThumbColor: "#fff" } as object) : {})}
    />
  );
}

export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <FieldRow label={label} hint={hint}>
      <Toggle label={label} value={value} onChange={onChange} />
    </FieldRow>
  );
}

/* ---------- segmented control ---------- */

export function Segmented<T extends string>({
  options, value, onChange, label,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const t = useTheme();
  return (
    <View role="radiogroup" aria-label={label} style={[styles.seg, { backgroundColor: t.surface2, borderColor: t.border }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            role="radio"
            aria-checked={on}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, on ? { backgroundColor: t.surface, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth } : null]}
          >
            <Text style={[type.label, { color: on ? t.text : t.text2, fontWeight: on ? "600" : "500" }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- buttons ---------- */

export function Button({
  title, onPress, tone = "secondary", icon, disabled, style,
}: { title: string; onPress: () => void; tone?: "primary" | "secondary" | "danger" | "ghost"; icon?: IconName; disabled?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  const c =
    tone === "primary" ? { bg: t.accent, fg: "#fff", border: t.accent }
    : tone === "danger" ? { bg: "transparent", fg: t.bad, border: t.border }
    : tone === "ghost" ? { bg: "transparent", fg: t.accent, border: "transparent" }
    : { bg: t.surface, fg: t.text, border: t.border };
  return (
    <Pressable
      role="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: c.bg, borderColor: c.border, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={c.fg} /> : null}
      <Text style={[type.label, { color: c.fg, fontWeight: "600" }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, disabled, color }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  const t = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: pressed ? t.surface2 : "transparent", opacity: disabled ? 0.3 : 1 }]}
    >
      <Icon name={icon} size={20} color={color ?? t.text2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, minHeight: 44 },
  inputText: { flex: 1, minWidth: 0, paddingVertical: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: space.lg, paddingVertical: space.md, minHeight: 56 },
  seg: { flexDirection: "row", borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, padding: 3, gap: 2, alignSelf: "flex-start", flexWrap: "wrap" },
  segItem: { paddingHorizontal: space.md, paddingVertical: 7, borderRadius: 6, minHeight: 36, justifyContent: "center" },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.lg, minHeight: 44, borderRadius: radius.sm, borderWidth: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
