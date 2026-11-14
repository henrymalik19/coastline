import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useLayout } from "../lib/layout";
import { radius, space, type, useTheme } from "../lib/theme";
import { Icon } from "./Icon";
import { Card } from "./ui";

/** Two panes side by side only when there is room; phones stack and let the page scroll. */
export const useTwoPane = () => useLayout().contentWidth >= 640;

/**
 * Full-height page whose panes scroll inside themselves: only on tall, wide (desktop) windows.
 * Tablets and folding phones keep two panes but let the page scroll, so the lists aren't squeezed.
 */
export function useFillPage(): boolean {
  const twoPane = useTwoPane();
  const { height } = useWindowDimensions();
  return twoPane && height >= 900;
}

export type MasterItem = { key: string; title: string; subtitle?: string; value?: string };

/**
 * Two-pane editor that fills its container's height:
 * - wide: detail on the left, a list of items on the right (click to switch)
 * - narrow (phones): a list of cards, one per item; the selected one is open (its detail inside),
 *   the others are a row you tap to open. The add buttons (listFooter) go below, and the page scrolls.
 * Wide: only the panes scroll (scroll indicators hidden); the page itself doesn't.
 */
export function MasterDetail({
  header, items, selected, onSelect, listTitle, listFooter, detailHead, detail, detailFooter, empty, label,
}: {
  header?: ReactNode;
  items: MasterItem[];
  selected: string | undefined;
  onSelect: (key: string) => void;
  listTitle: string;
  /** Under the list (e.g. add buttons); on phones, under the cards. */
  listFooter?: ReactNode;
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
  const fill = useFillPage();
  // when the page scrolls (phones, tablets), keep the item picker and the group header in view
  const sticky = Platform.OS === "web" && !fill ? ({ position: "sticky", top: 0, zIndex: 2 } as unknown as ViewStyle) : null;

  if (!twoPane) {
    const open = (key: string) => {
      onSelect(key);
      // web: the card that opens can land above the screen (the one before it folds); bring it into view
      if (Platform.OS === "web" && typeof document !== "undefined")
        setTimeout(() => document.getElementById(`md-${key}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
    };
    const row = (it: MasterItem, on: boolean) => (
      <Pressable
        role="button"
        aria-expanded={on}
        accessibilityLabel={[it.title, it.subtitle, it.value].filter(Boolean).join(", ")}
        onPress={() => open(it.key)}
        style={({ pressed }) => [styles.cardRow, pressed && !on ? { backgroundColor: t.surface2 } : null]}
      >
        <View style={{ transform: [{ rotate: on ? "90deg" : "0deg" }] }}>
          <Icon name="chevron" size={16} color={t.text3} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.body, { color: t.text, fontWeight: "600" }]}>{it.title || "Untitled"}</Text>
          {it.subtitle ? <Text numberOfLines={1} style={[type.caption, { color: t.text3 }]}>{it.subtitle}</Text> : null}
        </View>
        {it.value ? <Text style={[type.body, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{it.value}</Text> : null}
      </Pressable>
    );
    return (
      <View role="list" aria-label={label} style={{ gap: space.md }}>
        {header}
        {items.length === 0 && empty ? (
          <Card><View style={{ alignItems: "center", gap: space.md }}>{empty}</View></Card>
        ) : (
          items.map((it) => {
            const on = it.key === selected;
            return (
              <View key={it.key} nativeID={`md-${it.key}`} style={Platform.OS === "web" ? ({ scrollMarginTop: space.md } as object) : undefined}>
                <Card padded={false}>
                  {on ? (
                    <>
                      {/* its own header (name, total, actions) when it has one; else the row */}
                      <View style={[styles.head, { borderBottomColor: t.border }, sticky ? ({ ...sticky, backgroundColor: t.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg } as ViewStyle) : null]}>
                        {detailHead ?? row(it, true)}
                      </View>
                      <View>{detail}</View>
                      {detailFooter ? <View style={[styles.foot, { borderTopColor: t.border }]}>{detailFooter}</View> : null}
                    </>
                  ) : (
                    row(it, false)
                  )}
                </Card>
              </View>
            );
          })
        )}
        {listFooter}
      </View>
    );
  }

  const list = (
    <Card padded={false} style={{ ...styles.listPane, ...(sticky ? { ...sticky, top: space.sm } : null) }}>
      <Text style={[type.overline, { color: t.text3, padding: space.lg, paddingBottom: space.sm }]}>{listTitle}</Text>
      <ScrollView style={fill ? { flex: 1 } : undefined} scrollEnabled={fill} showsVerticalScrollIndicator={false}>
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
  );

  const pane = (
    <Card
      padded={false}
      style={{
        flex: 1, minWidth: 0, ...(fill ? { minHeight: 0 } : null),
      }}
    >
      {items.length === 0 && empty ? (
        <View style={{ flex: fill ? 1 : undefined, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md }}>{empty}</View>
      ) : (
        <>
          {detailHead ? (
            <View
              style={[
                styles.head,
                { borderBottomColor: t.border },
                // tablets: the group header sticks to the top of the page while its items scroll
                sticky ? { ...sticky, backgroundColor: t.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg } : null,
              ] as ViewStyle[]}
            >
              {detailHead}
            </View>
          ) : null}
          {fill ? (
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
    <View style={fill ? { flex: 1, minHeight: 440, gap: space.md } : { gap: space.md }}>
      {header}
      <View style={{ ...(fill ? { flex: 1, minHeight: 0 } : { alignItems: "flex-start" }), flexDirection: "row", gap: space.md }}>
        {pane}
        {list}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  listPane: { width: 270 },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.sm },
  cardRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.md, borderRadius: radius.lg },
  head: { borderBottomWidth: StyleSheet.hairlineWidth },
  foot: { padding: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
