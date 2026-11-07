import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLayout } from "../lib/layout";
import { radius, space, type, useTheme } from "../lib/theme";
import { Card } from "./ui";

/** Two panes side by side only when there is room; phones stack and let the page scroll. */
export const useTwoPane = () => useLayout().contentWidth >= 640;

export type MasterItem = { key: string; title: string; subtitle?: string; value?: string };

/**
 * Two-pane editor that fills its container's height:
 * - wide: detail on the left, a list of items on the right (click to switch)
 * - narrow (phones): the list becomes a chip row above the detail, and the page scrolls
 *   normally instead of squeezing the items into a small inner scroll box.
 * Wide: only the panes scroll (scroll indicators hidden); the page itself doesn't.
 */
export function MasterDetail({
  header, items, selected, onSelect, listTitle, listFooter, chipAdd, detailHead, detail, detailFooter, empty, label,
}: {
  header?: ReactNode;
  items: MasterItem[];
  selected: string | undefined;
  onSelect: (key: string) => void;
  listTitle: string;
  /** Wide layout: shown under the list (e.g. add buttons). */
  listFooter?: ReactNode;
  /** Narrow layout: trailing chip(s) after the item chips (e.g. "+ Group"). */
  chipAdd?: ReactNode;
  detailHead?: ReactNode;
  /** Scrolling body of the detail pane. */
  detail: ReactNode;
  detailFooter?: ReactNode;
  /** Shown instead of the detail pane when there are no items. */
  empty?: ReactNode;
  label: string;
}) {
  const t = useTheme();
  const twoPane = useTwoPane();

  const list = twoPane ? (
    <Card padded={false} style={styles.listPane}>
      <Text style={[type.overline, { color: t.text3, padding: space.lg, paddingBottom: space.sm }]}>{listTitle}</Text>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View role="tablist" aria-label={label} aria-orientation="vertical" style={{ paddingHorizontal: space.sm, gap: 2, paddingBottom: space.sm }}>
          {items.map((it) => {
            const on = it.key === selected;
            return (
              <Pressable
                key={it.key}
                role="tab"
                aria-selected={on}
                accessibilityLabel={[it.title, it.subtitle, it.value].filter(Boolean).join(", ")}
                onPress={() => onSelect(it.key)}
                style={(st) => {
                  const hovered = (st as typeof st & { hovered?: boolean }).hovered;
                  return [styles.listRow, { backgroundColor: on ? t.accentSoft : st.pressed || hovered ? t.surface2 : "transparent" }];
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={[type.body, { color: on ? t.accent : t.text, fontWeight: on ? "700" : "500" }]}>{it.title || "Untitled"}</Text>
                  {it.subtitle ? <Text numberOfLines={1} style={[type.caption, { color: t.text3 }]}>{it.subtitle}</Text> : null}
                </View>
                {it.value ? <Text style={[type.label, { color: on ? t.accent : t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{it.value}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      {listFooter ? <View style={[styles.foot, { borderTopColor: t.border }]}>{listFooter}</View> : null}
    </Card>
  ) : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingVertical: 2 }}>
      <View role="tablist" aria-label={label} style={{ flexDirection: "row", gap: space.sm }}>
        {items.map((it) => {
          const on = it.key === selected;
          return (
            <Pressable
              key={it.key}
              role="tab"
              aria-selected={on}
              accessibilityLabel={[it.title, it.value].filter(Boolean).join(", ")}
              onPress={() => onSelect(it.key)}
              style={[styles.chip, { backgroundColor: on ? t.accent : t.surface, borderColor: on ? t.accent : t.border }]}
            >
              <Text numberOfLines={1} style={[type.label, { color: on ? "#fff" : t.text, fontWeight: "600", maxWidth: 160 }]}>{it.title || "Untitled"}</Text>
              {it.value ? <Text style={[type.caption, { color: on ? "#fff" : t.text3, fontVariant: ["tabular-nums"] }]}>{it.value}</Text> : null}
            </Pressable>
          );
        })}
        {chipAdd}
      </View>
    </ScrollView>
  );

  const pane = (
    <Card padded={false} style={twoPane ? { flex: 1, minHeight: 0, minWidth: 0 } : undefined}>
      {items.length === 0 && empty ? (
        <View style={{ flex: twoPane ? 1 : undefined, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md }}>{empty}</View>
      ) : (
        <>
          {detailHead ? <View style={[styles.head, { borderBottomColor: t.border }]}>{detailHead}</View> : null}
          {twoPane ? (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {detail}
            </ScrollView>
          ) : (
            <View>{detail}</View>
          )}
          {detailFooter ? <View style={[styles.foot, { borderTopColor: t.border }]}>{detailFooter}</View> : null}
        </>
      )}
    </Card>
  );

  return (
    <View style={twoPane ? { flex: 1, minHeight: 440, gap: space.md } : { gap: space.md }}>
      {header}
      {twoPane ? (
        <View style={{ flex: 1, minHeight: 0, flexDirection: "row", gap: space.md }}>
          {pane}
          {list}
        </View>
      ) : (
        <>
          {list}
          {pane}
        </>
      )}
    </View>
  );
}

/** Dashed "+ Label" chip for the narrow layout. */
export function AddChip({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable role="button" accessibilityLabel={`Add ${label}`} onPress={onPress} style={[styles.chip, { borderColor: t.border, borderStyle: "dashed" }]}>
      <Text style={[type.label, { color: t.accent, fontWeight: "700" }]}>+ {label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  listPane: { width: 270 },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 40 },
  head: { borderBottomWidth: StyleSheet.hairlineWidth },
  foot: { padding: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
