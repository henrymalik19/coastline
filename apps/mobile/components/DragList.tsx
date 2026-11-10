/**
 * A list you reorder by dragging a row's grip (mouse or touch), with no extra library: React Native's
 * gesture responder works on the web too. The grip also takes the arrow keys (web) and the screen
 * reader's adjust actions, so reordering never needs a mouse.
 *
 * While you drag, the row follows the pointer and the rows it passes slide out of its way; letting
 * go calls `onMove(from, to)` once. Rows can be any height.
 */
import { useRef, useState, type ReactNode } from "react";
import { PanResponder, Platform, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { useTheme } from "../lib/theme";
import { Icon } from "./Icon";

type Drag = { from: number; dy: number };

export function DragList({
  count, keyOf, nameOf, onMove, renderItem, style,
}: {
  count: number;
  keyOf: (i: number) => string;
  /** The row's name, for screen readers ("Move Savings"). */
  nameOf?: (i: number) => string;
  /** Move the row at `from` so it ends up at `to` (both indexes in this list). */
  onMove: (from: number, to: number) => void;
  /** One row. Put `grip` where its drag handle goes (usually first in the row). */
  renderItem: (i: number, grip: ReactNode) => ReactNode;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const layouts = useRef<{ y: number; h: number }[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);

  const targetOf = (d: Drag): number => {
    const L = layouts.current;
    const me = L[d.from];
    if (!me) return d.from;
    // the row's leading edge decides (its top going up, its bottom going down), so a tall row
    // (one that's open) swaps as soon as it passes the middle of its neighbour
    const top = me.y + d.dy;
    const bottom = top + me.h;
    let to = d.from;
    if (d.dy > 0) for (let i = d.from + 1; i < count; i++) if (L[i] && bottom > L[i]!.y + L[i]!.h / 2) to = i;
    if (d.dy < 0) for (let i = d.from - 1; i >= 0; i--) if (L[i] && top < L[i]!.y + L[i]!.h / 2) to = i;
    return to;
  };
  const to = drag ? targetOf(drag) : -1;
  const shiftOf = (i: number): number => {
    if (!drag || i === drag.from) return drag?.dy ?? 0;
    const h = layouts.current[drag.from]?.h ?? 0;
    if (drag.from < to && i > drag.from && i <= to) return -h;
    if (to < drag.from && i >= to && i < drag.from) return h;
    return 0;
  };

  return (
    <View style={style}>
      {Array.from({ length: count }, (_, i) => {
        const dragging = drag?.from === i;
        return (
          <View
            key={keyOf(i)}
            onLayout={(e: LayoutChangeEvent) => {
              // only while nothing moves, so the slots stay where the rows really are
              if (!drag) layouts.current[i] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
            }}
            style={[
              { transform: [{ translateY: shiftOf(i) }] },
              dragging
                ? {
                    zIndex: 10,
                    backgroundColor: t.surface,
                    borderRadius: 8,
                    ...(Platform.OS === "web" ? ({ boxShadow: `0 6px 20px ${t.shadow}`, cursor: "grabbing" } as object) : { elevation: 6, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10 }),
                  }
                : drag
                  ? (Platform.OS === "web" ? ({ transition: "transform 120ms ease" } as object) : null)
                  : null,
            ]}
          >
            {renderItem(i, <Grip index={i} count={count} name={nameOf?.(i)} onMove={onMove} onDrag={setDrag} finish={(d) => { const j = targetOf(d); setDrag(null); if (j !== d.from) onMove(d.from, j); }} />)}
          </View>
        );
      })}
    </View>
  );
}

/** The drag handle for one row. */
function Grip({
  index, count, name, onMove, onDrag, finish,
}: {
  index: number; count: number; name?: string;
  onMove: (from: number, to: number) => void;
  onDrag: (d: Drag | null) => void;
  finish: (d: Drag) => void;
}) {
  const t = useTheme();
  // the responder lives across renders; it reads the latest props from here
  const live = useRef({ index, onDrag, finish });
  live.current = { index, onDrag, finish };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        if (Platform.OS === "web" && typeof document !== "undefined") document.body.style.userSelect = "none";
        live.current.onDrag({ from: live.current.index, dy: 0 });
      },
      onPanResponderMove: (_e, g) => live.current.onDrag({ from: live.current.index, dy: g.dy }),
      onPanResponderRelease: (_e, g) => end(g.dy),
      onPanResponderTerminate: (_e, g) => end(g.dy),
    }),
  ).current;
  function end(dy: number) {
    if (Platform.OS === "web" && typeof document !== "undefined") document.body.style.userSelect = "";
    live.current.finish({ from: live.current.index, dy });
  }
  const step = (by: -1 | 1) => {
    const j = index + by;
    if (j >= 0 && j < count) onMove(index, j);
  };
  return (
    <View
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Move ${name || "this row"}: drag, or use the arrow keys`}
      accessibilityActions={[{ name: "decrement", label: "Move up" }, { name: "increment", label: "Move down" }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "decrement" ? -1 : 1)}
      // web: focusable, and the arrow keys move the row
      {...(Platform.OS === "web"
        ? {
            tabIndex: 0,
            onKeyDown: (e: { key: string; preventDefault: () => void }) => {
              if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
              if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
            },
          } as object
        : null)}
      hitSlop={8}
      style={[{ paddingVertical: 6, paddingRight: 2, alignSelf: "center" }, Platform.OS === "web" ? ({ cursor: "grab", touchAction: "none" } as object) : null]}
    >
      <Icon name="grip" size={16} color={t.text3} />
    </View>
  );
}

/** Move one entry from `from` to `to` in a list (the others keep their order). */
export function moveTo<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, x!);
  return out;
}

/**
 * Reorder among only the entries `shown` picks (one group of a longer list): the shown entry at
 * `from` moves to `to` (indexes among the shown ones). Everything else keeps its place.
 */
export function reorderAmong<T>(list: T[], shown: (x: T) => boolean, from: number, to: number): T[] {
  const slots = list.map((x, i) => (shown(x) ? i : -1)).filter((i) => i >= 0);
  const moved = moveTo(slots.map((i) => list[i]!), from, to);
  const out = [...list];
  slots.forEach((pos, k) => { out[pos] = moved[k]!; });
  return out;
}
