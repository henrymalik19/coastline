import { useRef, useState, type ComponentRef } from "react";
import { Platform, View, type GestureResponderEvent } from "react-native";
import { useTheme } from "../lib/theme";

/**
 * Accessible slider: drag or tap the track, arrow keys on web, increment/decrement
 * actions for screen readers on native. Value snaps to `step`.
 */
export function Slider({
  value, min, max, step, onChange, label, valueText,
}: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string; valueText: string }) {
  const t = useTheme();
  const track = useRef<ComponentRef<typeof View>>(null);
  const box = useRef({ x: 0, w: 1 });
  const [active, setActive] = useState(false);
  const snap = (v: number) => {
    const s = Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step + min;
    return +s.toFixed(6);
  };
  const p = (Math.min(max, Math.max(min, value)) - min) / (max - min);
  const fromEvent = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.pageX - box.current.x;
    onChange(snap(min + (x / box.current.w) * (max - min)));
  };
  const measure = (then: () => void) =>
    track.current?.measureInWindow((x, _y, w) => {
      box.current = { x, w: Math.max(1, w) };
      then();
    });
  const nudge = (dir: 1 | -1) => onChange(snap(value + dir * step));

  return (
    <View
      ref={track}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      accessible
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === "increment" ? 1 : -1)}
      focusable
      // web keyboard support
      {...(Platform.OS === "web"
        ? {
            tabIndex: 0,
            onKeyDown: (e: { key: string; preventDefault: () => void }) => {
              if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); nudge(1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); nudge(-1); }
              if (e.key === "Home") { e.preventDefault(); onChange(min); }
              if (e.key === "End") { e.preventDefault(); onChange(max); }
            },
          } as object // DOM keyboard event shape (react-native-web)
        : {})}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        setActive(true);
        const ev = { nativeEvent: { pageX: e.nativeEvent.pageX } } as GestureResponderEvent;
        measure(() => fromEvent(ev));
      }}
      onResponderMove={fromEvent}
      onResponderRelease={() => setActive(false)}
      style={{ height: 36, justifyContent: "center", cursor: "pointer" } as object}
    >
      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.track }}>
        <View style={{ width: `${p * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.accent }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: `${p * 100}%`,
          marginLeft: -11,
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: "#fff",
          borderWidth: active ? 3 : 2,
          borderColor: t.accent,
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 1 },
        }}
      />
    </View>
  );
}
