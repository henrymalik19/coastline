import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type ViewStyle } from "react-native";
import { useLayout } from "../lib/layout";
import { radius, space, type, useTheme } from "../lib/theme";
import { formatDate, parseDate } from "../lib/dates";
import { CalendarModal, MonthModal } from "./Calendar";
import { Icon, type IconName } from "./Icon";

/* ---------- number input ---------- */

export type NumberKind = "money" | "percent" | "int" | "decimal";

/** Display text for a stored value. Percent is stored as a decimal (0.05 → "5"). */
const toText = (v: number, kind: NumberKind, pretty: boolean) => {
  if (!Number.isFinite(v)) return "";
  if (kind === "percent") return String(+(v * 100).toFixed(3));
  if (kind === "money") return pretty ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(+v.toFixed(2));
  return String(v);
};
const fromText = (s: string, kind: NumberKind) => {
  if (s.trim() === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (kind === "percent") return n / 100;
  if (kind === "int") return Math.round(n);
  return n;
};
/** Keep only what a number can contain: digits, one decimal point (not for ints), a leading minus if allowed. */
const sanitize = (s: string, kind: NumberKind, allowNegative: boolean) => {
  let out = s.replace(kind === "int" ? /[^\d-]/g : /[^\d.-]/g, "");
  const neg = allowNegative && out.startsWith("-");
  out = out.replace(/-/g, "");
  const dot = out.indexOf(".");
  if (dot >= 0) out = out.slice(0, dot + 1) + out.slice(dot + 1).replace(/\./g, "");
  return (neg ? "-" : "") + out;
};
const defaultStep: Record<NumberKind, number> = { money: 50, percent: 0.25, int: 1, decimal: 0.5 };

/**
 * Save what's typed after a short pause instead of on every key: each save re-runs the plan and
 * redraws the page, which made typing lag. The box shows the text right away; `flush` saves now
 * (on leaving the box). Anything still waiting is saved if the box goes away.
 */
function useTypingSave<T>(onChange: (v: T) => void, delay = 300) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const pending = useRef<{ v: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) latest.current(p.v);
  };
  const push = (v: T) => {
    pending.current = { v };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { push, flush, waiting: () => pending.current !== null };
}

/**
 * Number-only input: typing anything else is ignored, Up/Down arrows nudge the value
 * (web), money shows thousands separators when not editing, $ / % adornments.
 * `step` is in display units (e.g. 0.25 for percent = 0.25 percentage points).
 */
export function NumberInput({
  value, onChange, kind = "decimal", label, width = 140, min = 0, max, step, stepper = true,
}: {
  value: number; onChange: (v: number) => void; kind?: NumberKind; label: string; width?: number | "100%";
  min?: number; max?: number; step?: number;
  /** Show the up/down arrow buttons (tap to nudge, hold to repeat). */
  stepper?: boolean;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(toText(value, kind, true));
  const typing = useTypingSave(onChange);
  useEffect(() => {
    if (!focused && !typing.waiting()) setText(toText(value, kind, true));
  }, [value, kind, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n));
  const s = step ?? defaultStep[kind];
  // latest value for press-and-hold repeats (the closure would otherwise be stale)
  const current = useRef(value);
  current.current = value;
  const nudge = (dir: 1 | -1) => {
    const display = kind === "percent" ? current.current * 100 : current.current;
    const next = +(Math.round((display + dir * s) / s) * s).toFixed(6);
    const stored = clamp(kind === "percent" ? next / 100 : next);
    current.current = stored;
    typing.flush();
    onChange(stored);
    setText(toText(stored, kind, focused ? false : true));
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeated = useRef(false);
  const stopRepeat = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopRepeat, []);
  const startRepeat = (dir: 1 | -1) => {
    stopRepeat();
    repeated.current = false;
    const tick = (delay: number) => {
      timer.current = setTimeout(() => { repeated.current = true; nudge(dir); tick(Math.max(40, delay * 0.85)); }, delay);
    };
    tick(400);
  };
  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;
  const arrow = (dir: 1 | -1) => (
    <Pressable
      role="button"
      accessibilityLabel={`${dir > 0 ? "Increase" : "Decrease"} ${label}`}
      disabled={dir > 0 ? atMax : atMin}
      focusable={false}
      hitSlop={{ left: 6, right: 6, top: dir > 0 ? 6 : 0, bottom: dir > 0 ? 0 : 6 }}
      onPress={() => { if (!repeated.current) nudge(dir); repeated.current = false; }}
      onPressIn={() => startRepeat(dir)}
      onPressOut={stopRepeat}
      style={(st) => {
        const hovered = (st as typeof st & { hovered?: boolean }).hovered;
        return [styles.stepBtn, { backgroundColor: st.pressed ? t.accentSoft : hovered ? t.surface : "transparent", opacity: (dir > 0 ? atMax : atMin) ? 0.3 : 1 }];
      }}
    >
      <Icon name={dir > 0 ? "up" : "down"} size={14} color={t.text2} />
    </Pressable>
  );
  return (
    <View style={[styles.input, { width, borderColor: focused ? t.accent : t.border, backgroundColor: t.surface2, paddingRight: stepper ? 4 : space.md }]}>
      {kind === "money" ? <Text style={[type.body, { color: t.text3 }]}>$</Text> : null}
      <TextInput
        accessibilityLabel={label}
        value={text}
        onChangeText={(raw) => {
          const clean = sanitize(raw, kind, min < 0);
          setText(clean);
          const n = fromText(clean, kind);
          if (n !== null) {
            current.current = clamp(n);
            typing.push(clamp(n));
          }
        }}
        onFocus={() => {
          setFocused(true);
          setText(toText(value, kind, false));
        }}
        onBlur={() => {
          typing.flush();
          setFocused(false);
          if (fromText(text, kind) === null) onChange(clamp(0));
        }}
        keyboardType={kind === "int" ? "number-pad" : "decimal-pad"}
        inputMode={kind === "int" ? "numeric" : "decimal"}
        selectTextOnFocus
        {...(Platform.OS === "web"
          ? ({
              onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                if (e.key === "ArrowUp") { e.preventDefault(); nudge(1); }
                if (e.key === "ArrowDown") { e.preventDefault(); nudge(-1); }
              },
            } as object)
          : {})}
        style={[type.body, styles.inputText, { color: t.text, textAlign: "right", fontVariant: ["tabular-nums"] }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
      />
      {kind === "percent" ? <Text style={[type.body, { color: t.text3 }]}>%</Text> : null}
      {stepper ? (
        <View style={[styles.stepper, { borderLeftColor: t.border }]}>
          {arrow(1)}
          {arrow(-1)}
        </View>
      ) : null}
    </View>
  );
}

/* ---------- tooltip ---------- */

/** ⓘ button that reveals an explanation: tap anywhere, hover on web. Text stays inline so it never covers inputs. */
export function InfoTip({ label, open, onToggle }: { text: string; label: string; open: boolean; onToggle: (v: boolean) => void }) {
  const t = useTheme();
  // hover previews; a click/tap pins it open until clicked again
  const pinned = useRef(false);
  return (
    <Pressable
      role="button"
      accessibilityLabel={`What is ${label}?`}
      aria-expanded={open}
      hitSlop={10}
      onPress={() => {
        pinned.current = !pinned.current;
        onToggle(pinned.current);
      }}
      onHoverIn={() => onToggle(true)}
      onHoverOut={() => { if (!pinned.current) onToggle(false); }}
      style={{ padding: 2 }}
    >
      <Icon name="info" size={16} color={open ? t.accent : t.text3} />
    </Pressable>
  );
}

export function InfoText({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View role="note" style={[styles.tip, { backgroundColor: t.accentSoft }]}>
      <Text style={[type.caption, { color: t.text }]}>{text}</Text>
    </View>
  );
}

export function TextField({
  value, onChange, label, placeholder, width = "100%",
}: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; width?: number | "100%" }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);
  const typing = useTypingSave(onChange);
  useEffect(() => {
    if (!typing.waiting()) setDraft(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={[styles.input, { width, borderColor: focused ? t.accent : t.border, backgroundColor: t.surface2 }]}>
      <TextInput
        accessibilityLabel={label}
        value={draft}
        placeholder={placeholder}
        placeholderTextColor={t.text3}
        onChangeText={(v) => { setDraft(v); typing.push(v); }}
        onFocus={() => setFocused(true)}
        onBlur={() => { typing.flush(); setFocused(false); }}
        style={[type.body, styles.inputText, { color: t.text }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
      />
    </View>
  );
}

/**
 * Date field: type a date the way you normally would (11/20/2026, Nov 20, 2026-11-20…)
 * or pick it from a calendar. Shows "Nov 20, 2026" when not editing; stores ISO.
 */
export function DateField({ value, onChange, label, width = 190 }: { value?: string; onChange: (v: string | undefined) => void; label: string; width?: number }) {
  const t = useTheme();
  const [text, setText] = useState(formatDate(value));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatDate(value));
  }, [value, focused]);
  const commit = () => {
    setFocused(false);
    if (!text.trim()) {
      setBad(false);
      onChange(undefined);
      return;
    }
    const iso = parseDate(text);
    if (iso) {
      setBad(false);
      onChange(iso);
      setText(formatDate(iso));
    } else setBad(true);
  };
  return (
    <View style={{ gap: 2, alignItems: "flex-end" }}>
      <View style={[styles.input, { width, borderColor: bad ? t.bad : focused ? t.accent : t.border, backgroundColor: t.surface2, paddingRight: 2 }]}>
        <TextInput
          accessibilityLabel={label}
          value={text}
          placeholder="MM/DD/YYYY"
          placeholderTextColor={t.text3}
          onChangeText={(s) => { setText(s); setBad(false); }}
          onFocus={() => setFocused(true)}
          onBlur={commit}
          onSubmitEditing={commit}
          style={[type.body, styles.inputText, { color: t.text }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
        />
        <IconButton icon="calendar" label={`Pick ${label.toLowerCase()} from a calendar`} onPress={() => setPicking(true)} />
      </View>
      {bad ? <Text style={[type.caption, { color: t.bad }]}>Try a date like 11/20/2026</Text> : null}
      {picking ? (
        <CalendarModal
          visible
          title={label}
          value={value}
          onClose={() => setPicking(false)}
          onPick={(iso) => { setBad(false); onChange(iso); setText(formatDate(iso)); }}
        />
      ) : null}
    </View>
  );
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Month field: shows "Nov 2027" and opens a month + year picker. Stores "YYYY-MM". */
export function MonthField({ value, onChange, label, width = 160, min, max }: { value?: string; onChange: (v: string) => void; label: string; width?: number; /** Earliest and latest month ("YYYY-MM"). */ min?: string; max?: string }) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  const shown = value ? `${MONTH_SHORT[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}` : "Pick a month";
  return (
    <>
      <Pressable
        role="button"
        accessibilityLabel={`${label}: ${shown}. Change`}
        onPress={() => setPicking(true)}
        style={[styles.input, { width, borderColor: t.border, backgroundColor: t.surface2, paddingRight: 8, justifyContent: "space-between" }]}
      >
        <Text style={[type.body, { color: value ? t.text : t.text3 }]}>{shown}</Text>
        <Icon name="calendar" size={18} color={t.text2} />
      </Pressable>
      {picking ? <MonthModal visible title={label} value={value} min={min} max={max} onClose={() => setPicking(false)} onPick={onChange} /> : null}
    </>
  );
}

/* ---------- rows ---------- */

/** A settings row: label (with optional ⓘ explanation) and hint on the left, control on the right. */
export function FieldRow({ label, hint, info, children, stacked }: { label: string; hint?: string; info?: string; children: ReactNode; stacked?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ paddingVertical: space.md, gap: space.sm }}>
      <View style={[styles.rowInner, stacked ? { flexDirection: "column", alignItems: "stretch" } : null]}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[type.body, { color: t.text, flexShrink: 1 }]}>{label}</Text>
            {info ? <InfoTip text={info} label={label} open={open} onToggle={setOpen} /> : null}
          </View>
          {hint ? <Text style={[type.caption, { color: t.text3 }]}>{hint}</Text> : null}
        </View>
        {children}
      </View>
      {info && open ? <InfoText text={info} /> : null}
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

/** A dropdown: shows the choice, opens a list. Saves room where a Segmented row would wrap. */
export function Select<T extends string>({
  options, value, onChange, label, plain, placeholder,
}: {
  options: { value: T; label: string; hint?: string }[]; value: T; onChange: (v: T) => void; label: string;
  /** No box: right-aligned text and a chevron, for list rows. */
  plain?: boolean;
  placeholder?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        role="button"
        aria-haspopup="listbox"
        accessibilityLabel={`${label}: ${cur?.label ?? "none"}. Change`}
        onPress={() => setOpen(true)}
        style={plain ? styles.selectPlain : [styles.select, { borderColor: t.border, backgroundColor: t.surface2 }]}
      >
        <Text style={[type.body, { color: cur && cur.value ? t.text : t.text3, flex: 1, textAlign: plain ? "right" : "left" }]} numberOfLines={1}>{cur && cur.value ? cur.label : placeholder ?? cur?.label ?? "Pick one"}</Text>
        <Icon name={plain ? "chevron" : "down"} size={plain ? 14 : 16} color={t.text3} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel={`Close ${label}`}>
          <Pressable onPress={() => {}} aria-label={label} style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[type.overline, { color: t.text3, paddingHorizontal: space.md, paddingBottom: 4 }]}>{label}</Text>
            <ScrollView style={{ maxHeight: 440 }}>
              {options.map((o) => {
                const on = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    role="option"
                    aria-selected={on}
                    onPress={() => { onChange(o.value); setOpen(false); }}
                    style={({ pressed }) => [styles.option, { backgroundColor: on ? t.accentSoft : pressed ? t.surface2 : "transparent" }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.body, { color: on ? t.accent : t.text, fontWeight: on ? "700" : "500" }]}>{o.label}</Text>
                      {o.hint ? <Text style={[type.caption, { color: t.text3 }]}>{o.hint}</Text> : null}
                    </View>
                    {on ? <Icon name="check" size={16} color={t.accent} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** Segmented on wide screens, a dropdown on phones. */
export function Choice<T extends string>(props: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const { contentWidth } = useLayout();
  return contentWidth < 600 ? <Select {...props} /> : <Segmented {...props} />;
}

/* ---------- list rows: a grouped box of "label … value" rows (forms on phones) ---------- */

/** A rounded box of rows with thin dividers between them. */
export function FormList({ children }: { children: ReactNode }) {
  const t = useTheme();
  const items = (Array.isArray(children) ? children.flat() : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return (
    <View style={[styles.formList, { borderColor: t.border, backgroundColor: t.surface }]}>
      {items.map((c, i) => (
        <View key={i}>
          {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: space.md }} /> : null}
          {c}
        </View>
      ))}
    </View>
  );
}

/** One row: the label on the left (with an optional hint under it), the value or control on the right. */
export function FormRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.formRow}>
      <View style={{ flexShrink: 1, flexGrow: 1, minWidth: 0, gap: 1 }}>
        <Text style={[type.body, { color: t.text }]}>{label}</Text>
        {hint ? <Text style={[type.caption, { color: t.text3 }]}>{hint}</Text> : null}
      </View>
      <View style={{ flexShrink: 0, maxWidth: "62%", alignItems: "flex-end" }}>{children}</View>
    </View>
  );
}

/** Text typed straight into a row (right-aligned). Saves as you type, or on finishing with `commitOnBlur`. */
export function InlineText({ value, onChange, label, placeholder, commitOnBlur }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; commitOnBlur?: boolean }) {
  const t = useTheme();
  const [draft, setDraft] = useState(value);
  const typing = useTypingSave(onChange);
  useEffect(() => {
    if (!typing.waiting()) setDraft(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TextInput
      accessibilityLabel={label}
      value={draft}
      onChangeText={commitOnBlur ? setDraft : (v) => { setDraft(v); typing.push(v); }}
      onBlur={commitOnBlur ? () => draft.trim() && draft !== value && onChange(draft) : typing.flush}
      onSubmitEditing={commitOnBlur ? () => draft.trim() && draft !== value && onChange(draft) : undefined}
      placeholder={placeholder}
      placeholderTextColor={t.text3}
      style={[type.body, styles.inlineText, { color: t.text }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
    />
  );
}

/** A dollar amount typed straight into a row (right-aligned, saved when you finish). */
export function InlineMoney({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const t = useTheme();
  const show = (v: number) => (Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "");
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(show(value));
  }, [value, focused]);
  const commit = () => {
    setFocused(false);
    const v = Number(text.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(v) && Math.abs(v - value) > 0.004) onChange(Math.round(v * 100) / 100);
    else setText(show(value));
  };
  return (
    <View style={[styles.inlineMoney, { borderColor: focused ? t.accent : t.border, backgroundColor: t.surface2 }]}>
      <Text style={[type.body, { color: t.text3 }]}>$</Text>
      <TextInput
        accessibilityLabel={label}
        value={text}
        onChangeText={setText}
        onFocus={() => { setFocused(true); setText(value ? String(+value.toFixed(2)) : ""); }}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={t.text3}
        selectTextOnFocus
        style={[type.body, { color: t.text, textAlign: "right", minWidth: 64, maxWidth: 120, paddingVertical: 6, fontVariant: ["tabular-nums"] }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
      />
    </View>
  );
}

/** A switch that sits on the right of a FormRow. */
export function InlineSwitch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const t = useTheme();
  return <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: t.accent, false: t.border }} thumbColor="#fff" />;
}

/** A small rounded button for quick actions in a row of choices. */
export function Chip({ title, onPress, icon, tone = "neutral", disabled }: { title: string; onPress: () => void; icon?: IconName; tone?: "neutral" | "accent" | "danger"; disabled?: boolean }) {
  const t = useTheme();
  const fg = tone === "danger" ? t.bad : tone === "accent" ? t.accent : t.text2;
  return (
    <Pressable
      role="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: tone === "accent" ? t.accent : t.border, backgroundColor: tone === "accent" ? t.accentSoft : pressed ? t.surface2 : t.surface, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <Text style={[type.caption, { color: fg, fontWeight: "700" }]}>{title}</Text>
    </Pressable>
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
  formList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: "hidden" },
  formRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: 8, minHeight: 50 },
  inlineText: { textAlign: "right", paddingVertical: 10, minWidth: 140 },
  inlineMoney: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  selectPlain: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, flex: 1 },
  select: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, minHeight: 44 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: space.lg },
  sheet: { width: "100%", maxWidth: 380, borderRadius: radius.lg, borderWidth: 1, paddingVertical: space.md },
  option: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 10 },
  input: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, minHeight: 44 },
  inputText: { flex: 1, minWidth: 0, paddingVertical: 10 },
  stepper: { alignSelf: "stretch", justifyContent: "center", borderLeftWidth: StyleSheet.hairlineWidth, paddingLeft: 4, marginLeft: 4, gap: 1 },
  stepBtn: { width: 24, height: 19, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  rowInner: { flexDirection: "row", alignItems: "center", gap: space.lg, minHeight: 32 },
  tip: { borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 10 },
  seg: { flexDirection: "row", borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, padding: 3, gap: 2, alignSelf: "flex-start", flexWrap: "wrap" },
  segItem: { paddingHorizontal: space.md, paddingVertical: 7, borderRadius: 6, minHeight: 36, justifyContent: "center" },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.lg, minHeight: 44, borderRadius: radius.sm, borderWidth: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
