/**
 * + − × ÷ = keys just above a phone's keyboard while you type in a number box (the number pad has
 * none). Pressing one doesn't take the focus from the box, so you keep typing.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useMathKeys } from "../lib/calc";
import { radius, space, type, useTheme } from "../lib/theme";

const KEYS = ["+", "−", "×", "÷", "="] as const;

export function MathBar() {
  const t = useTheme();
  const target = useMathKeys((s) => s.target);
  // how far the keyboard covers the bottom of the page (the bar sits on top of it)
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!target || Platform.OS !== "web" || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const place = () => setLift(Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)));
    place();
    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
    };
  }, [target]);
  if (!target) return null;
  const bar = (
    <View
      role="toolbar"
      aria-label="Math keys"
      style={[styles.bar, { bottom: lift, backgroundColor: t.surface, borderTopColor: t.border }, Platform.OS === "web" ? ({ position: "fixed" } as object) : null]}
    >
      {KEYS.map((k) => (
        <Pressable
          key={k}
          role="button"
          accessibilityLabel={k === "=" ? "Work it out" : `Type ${k}`}
          onPress={() => target.key(k)}
          // keep the focus (and the keyboard) on the number box
          {...(Platform.OS === "web" ? ({ onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object) : {})}
          focusable={false}
          style={({ pressed }) => [styles.key, { backgroundColor: pressed ? t.accentSoft : k === "=" ? t.accentSoft : t.surface2, borderColor: t.border }]}
        >
          <Text style={[type.heading, { color: k === "=" ? t.accent : t.text }]}>{k}</Text>
        </Pressable>
      ))}
    </View>
  );
  // on the web: on top of everything, a sheet like Add transaction included
  if (Platform.OS === "web" && typeof document !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPortal } = require("react-dom") as { createPortal: (node: ReactNode, into: Element) => ReactNode };
    return createPortal(bar, document.body);
  }
  return bar;
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, zIndex: 100000, flexDirection: "row", gap: space.sm, padding: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  key: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
});
