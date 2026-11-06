import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { isoParts, toISO } from "../lib/dates";
import { radius, space, type, useTheme } from "../lib/theme";
import { Icon, type IconName } from "./Icon";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Month calendar in a modal: pick a day, or move between months with ‹ ›. */
export function CalendarModal({
  visible, value, onPick, onClose, title,
}: { visible: boolean; value?: string; onPick: (iso: string) => void; onClose: () => void; title: string }) {
  const t = useTheme();
  const now = new Date();
  const todayIso = toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const start = value ? isoParts(value) : { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  const [view, setView] = useState({ y: start.y, m: start.m });
  const shift = (n: number) => setView((v) => {
    const k = v.y * 12 + (v.m - 1) + n;
    return { y: Math.floor(k / 12), m: (k % 12) + 1 };
  });

  const first = new Date(view.y, view.m - 1, 1).getDay();
  const days = new Date(view.y, view.m, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close calendar">
        {/* inner Pressable swallows taps so they don't close the modal */}
        <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]} role="dialog" aria-label={title}>
          <Text style={[type.label, { color: t.text3 }]}>{title}</Text>
          <View style={styles.head}>
            <NavButton icon="back" label="Previous month" onPress={() => shift(-1)} />
            <Text style={[type.heading, { color: t.text }]} aria-live="polite">{MONTHS[view.m - 1]} {view.y}</Text>
            <NavButton icon="chevron" label="Next month" onPress={() => shift(1)} />
          </View>
          <View style={styles.week}>
            {DOW.map((d, i) => (
              <Text key={i} style={[type.caption, styles.dow, { color: t.text3 }]} aria-label={DOW_LONG[i]}>{d}</Text>
            ))}
          </View>
          {weeks.map((w, wi) => (
            <View key={wi} style={styles.week}>
              {w.map((d, di) => {
                if (d === null) return <View key={di} style={styles.cell} />;
                const iso = toISO(view.y, view.m, d);
                const on = iso === value;
                const isToday = iso === todayIso;
                return (
                  <Pressable
                    key={di}
                    role="button"
                    aria-selected={on}
                    accessibilityLabel={`${DOW_LONG[di]}, ${MONTHS[view.m - 1]} ${d}, ${view.y}${isToday ? ", today" : ""}`}
                    onPress={() => { onPick(iso); onClose(); }}
                    style={(st) => {
                      const hovered = (st as typeof st & { hovered?: boolean }).hovered;
                      return [
                        styles.cell,
                        styles.day,
                        { backgroundColor: on ? t.accent : st.pressed || hovered ? t.surface2 : "transparent", borderColor: isToday && !on ? t.accent : "transparent" },
                      ];
                    }}
                  >
                    <Text style={[type.body, { color: on ? "#fff" : t.text, fontWeight: on || isToday ? "700" : "400" }]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <View style={[styles.head, { marginTop: space.sm }]}>
            <TextButton title="Today" color={t.accent} onPress={() => { onPick(todayIso); onClose(); }} />
            <TextButton title="Cancel" color={t.text2} onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function NavButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable role="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.nav, { backgroundColor: pressed ? t.surface2 : "transparent" }]}>
      <Icon name={icon} size={20} color={t.text2} />
    </Pressable>
  );
}

function TextButton({ title, color, onPress }: { title: string; color: string; onPress: () => void }) {
  return (
    <Pressable role="button" accessibilityLabel={title} onPress={onPress} style={styles.textBtn}>
      <Text style={[type.label, { color, fontWeight: "600" }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nav: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  textBtn: { paddingHorizontal: space.md, minHeight: 44, justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: space.lg },
  sheet: { width: "100%", maxWidth: 340, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: 4 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  week: { flexDirection: "row" },
  dow: { flex: 1, textAlign: "center", paddingVertical: 4 },
  cell: { flex: 1, aspectRatio: 1, maxHeight: 44 },
  day: { alignItems: "center", justifyContent: "center", borderRadius: 999, borderWidth: 1.5 },
});
