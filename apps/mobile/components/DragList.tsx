/**
 * A list you reorder by dragging a row's grip (mouse or touch), with no extra library: React Native's
 * gesture responder works on the web too. The grip also takes the arrow keys (web) and the screen
 * reader's adjust actions, so reordering never needs a mouse.
 *
 * While you drag, the row follows the pointer and the rows it passes slide out of its way; letting
 * go calls `onMove(from, to)` once. Rows can be any height.
 *
 * Lists in the same `zone` (groups on one page) also take rows from each other: drag a row over
 * another list and it lights up, with a line where the row will land; letting go calls the zone's
 * `onCross`. Near the top or bottom of the screen the page scrolls (web), so far groups are reachable.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Platform, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { useTheme } from "../lib/theme";
import { Icon } from "./Icon";

/** `y`: the pointer, in window coordinates (to find the list it's over). */
type Drag = { from: number; dy: number; y?: number };
type Rect = { top: number; height: number };
type Over = { id: string; index: number };

/** Lists on one page whose rows can move between them. */
export type DragZone = {
  lists: Map<string, { node: unknown; layouts: { y: number; h: number }[]; rect?: Rect }>;
  over: Over | null;
  overRef: { current: Over | null };
  setOver: (o: Over | null) => void;
  onCross: (fromList: string, from: number, toList: string, to: number) => void;
};

/** A zone for several DragLists: `onCross` moves a row from one list to another (index `to` in it). */
export function useDragZone(onCross: DragZone["onCross"]): DragZone {
  const [over, setOverState] = useState<Over | null>(null);
  const lists = useRef(new Map<string, { node: unknown; layouts: { y: number; h: number }[]; rect?: Rect }>()).current;
  const overRef = useRef<Over | null>(null);
  const cross = useRef(onCross);
  cross.current = onCross;
  return useMemo(
    () => ({
      lists,
      over,
      overRef,
      setOver: (o: Over | null) => {
        const cur = overRef.current;
        if (cur?.id === o?.id && cur?.index === o?.index) return;
        overRef.current = o;
        setOverState(o);
      },
      onCross: (a: string, b: number, c: string, d: number) => cross.current(a, b, c, d),
    }),
    [over, lists],
  );
}

/** Where a list is on screen: live on the web; on phones, measured when a drag starts. */
const rectOf = (l: { node: unknown; rect?: Rect }): Rect | undefined => {
  const n = l.node as { getBoundingClientRect?: () => DOMRect } | null;
  if (Platform.OS === "web" && n?.getBoundingClientRect) { const r = n.getBoundingClientRect(); return { top: r.top, height: r.height }; }
  return l.rect;
};

export function DragList({
  count, keyOf, nameOf, onMove, renderItem, style, zone, grips = true,
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
  /** Share a zone (useDragZone) with other lists so rows can be dragged between them; `id` names this one. */
  zone?: { set: DragZone; id: string };
  /** Show the grips (false: rows render without one, e.g. on a phone until you tap Reorder). */
  grips?: boolean;
}) {
  const t = useTheme();
  const layouts = useRef<{ y: number; h: number }[]>([]);
  const [drag, setDragState] = useState<Drag | null>(null);
  const node = useRef<unknown>(null);
  if (zone) {
    const prev = zone.set.lists.get(zone.id);
    zone.set.lists.set(zone.id, { node: node.current, layouts: layouts.current, rect: prev?.rect });
  }
  const zoneLists = zone?.set.lists;
  const zoneId = zone?.id;
  useEffect(() => () => { if (zoneLists && zoneId) zoneLists.delete(zoneId); }, [zoneLists, zoneId]);
  const setNode = (n: unknown) => {
    node.current = n;
    const e = zone?.set.lists.get(zone.id);
    if (e) e.node = n;
  };
  // over another list of the zone: which one, and where in it
  const overOther = (d: Drag): Over | null => {
    if (!zone || d.y === undefined) return null;
    for (const [id, l] of zone.set.lists) {
      if (id === zone.id) continue;
      const r = rectOf(l);
      if (!r || d.y < r.top - 8 || d.y > r.top + r.height + 8) continue;
      const index = l.layouts.filter((x) => x && r.top + x.y + x.h / 2 < d.y!).length;
      return { id, index };
    }
    return null;
  };
  const setDrag = (d: Drag | null) => {
    // phones: where every list is, once, as the drag starts
    if (d && !drag && zone && Platform.OS !== "web") {
      for (const l of zone.set.lists.values()) {
        (l.node as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null)?.measureInWindow?.((_x, y, _w, h) => { l.rect = { top: y, height: h }; });
      }
    }
    if (zone) zone.set.setOver(d ? overOther(d) : null);
    setDragState(d);
  };
  const finish = (d: Drag) => {
    const other = zone ? overOther(d) : null;
    const j = other ? d.from : targetOf(d);
    setDrag(null);
    if (other && zone) zone.set.onCross(zone.id, d.from, other.id, other.index);
    else if (j !== d.from) onMove(d.from, j);
  };
  const awayHere = !!(zone && drag && zone.set.over);
  const target = zone && zone.set.over?.id === zone.id ? zone.set.over : null;

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
  // over another list: the rows here stay put
  const to = drag ? (awayHere ? drag.from : targetOf(drag)) : -1;
  const shiftOf = (i: number): number => {
    if (!drag || i === drag.from) return drag?.dy ?? 0;
    const h = layouts.current[drag.from]?.h ?? 0;
    if (drag.from < to && i > drag.from && i <= to) return -h;
    if (to < drag.from && i >= to && i < drag.from) return h;
    return 0;
  };

  // where a row dragged in from another list will land
  const lineY = target ? (target.index < count ? (layouts.current[target.index]?.y ?? 0) : (() => { const l = layouts.current[count - 1]; return l ? l.y + l.h : 0; })()) : 0;
  return (
    <View
      ref={setNode as never}
      style={[
        style,
        // above the other groups while a row is dragged out of it
        drag ? { zIndex: 20 } : null,
        target ? { backgroundColor: t.accentSoft, borderRadius: 8, ...(Platform.OS === "web" ? ({ outline: `2px dashed ${t.accent}`, outlineOffset: -2 } as object) : { borderWidth: 2, borderColor: t.accent }) } : null,
        !count && zone ? { minHeight: 40 } : null,
      ]}
    >
      {target ? <View pointerEvents="none" style={{ position: "absolute", left: 8, right: 8, top: lineY - 1, height: 3, borderRadius: 2, backgroundColor: t.accent, zIndex: 5 }} /> : null}
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
            {renderItem(i, !grips ? null : <Grip index={i} count={count} name={nameOf?.(i)} onMove={onMove} onDrag={setDrag} finish={finish} />)}
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
  const me = useRef<unknown>(null);
  // the drag so far: the gesture's own move, the pointer, and (web) the page scrolling under it
  const st = useRef({ dy: 0, y: 0, y0: 0, scroller: null as HTMLElement | null, startTop: 0, timer: 0 as ReturnType<typeof setInterval> | 0 });
  const current = (): Drag => {
    const s = st.current;
    return { from: live.current.index, dy: s.dy + (s.scroller ? s.scroller.scrollTop - s.startTop : 0), y: s.y };
  };
  // web: the pointer in the window (the gesture's page coordinates, less any scroll of the page itself)
  const clientY = (pageY: number) => (Platform.OS === "web" && typeof window !== "undefined" ? pageY - window.scrollY : pageY);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_e, g) => {
        const s = st.current;
        s.dy = 0;
        s.y = clientY(g.y0);
        s.y0 = s.y;
        if (Platform.OS === "web" && typeof document !== "undefined") {
          document.body.style.userSelect = "none";
          s.scroller = scrollParent(me.current as HTMLElement | null);
          s.startTop = s.scroller?.scrollTop ?? 0;
          // near the top or bottom edge, scroll the page so far groups come into reach
          s.timer = setInterval(() => {
            const sc = s.scroller;
            if (!sc) return;
            const box = sc === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
            const edge = 90;
            const by = s.y < box.top + edge + 60 ? -Math.ceil((box.top + edge + 60 - s.y) / 6) : s.y > box.bottom - edge ? Math.ceil((s.y - (box.bottom - edge)) / 6) : 0;
            if (!by) return;
            const before = sc.scrollTop;
            sc.scrollTop += Math.max(-24, Math.min(24, by));
            if (sc.scrollTop !== before) live.current.onDrag(current());
          }, 16);
        }
        live.current.onDrag(current());
      },
      onPanResponderMove: (_e, g) => {
        st.current.y = clientY(g.moveY);
        // the pointer from where it started (a quick drag can report no move of its own)
        st.current.dy = g.dy || st.current.y - st.current.y0;
        live.current.onDrag(current());
      },
      onPanResponderRelease: (_e, g) => end(g),
      onPanResponderTerminate: (_e, g) => end(g),
    }),
  ).current;
  function end(g: { dy: number; moveY: number }) {
    const s = st.current;
    if (s.timer) clearInterval(s.timer);
    s.timer = 0;
    if (Platform.OS === "web" && typeof document !== "undefined") document.body.style.userSelect = "";
    if (g.moveY) s.y = clientY(g.moveY);
    s.dy = g.dy || s.y - s.y0;
    // web: a drag that moved isn't also a tap on the row it ends over
    if (Platform.OS === "web" && typeof window !== "undefined" && Math.abs(s.y - s.y0) > 4) {
      const eat = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
      window.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 50);
    }
    const d = current();
    s.scroller = null;
    live.current.finish(d);
  }
  useEffect(() => () => { if (st.current.timer) clearInterval(st.current.timer); }, []);
  const step = (by: -1 | 1) => {
    const j = index + by;
    if (j >= 0 && j < count) onMove(index, j);
  };
  return (
    <View
      ref={me as never}
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

/** Web: the element that scrolls the page around `el` (or the document). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
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
