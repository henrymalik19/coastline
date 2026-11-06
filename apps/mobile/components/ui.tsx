import type { ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "../lib/layout";
import { CONTENT_MAX_WIDTH, CONTENT_MAX_WIDTH_WIDE, radius, space, type, useTheme } from "../lib/theme";

/**
 * Scrolling page with a large title and safe-area padding. On the web the content
 * fills the available width (capped on huge monitors); native tablets keep a
 * phone-width column.
 */
export function Screen({ title, subtitle, children, right }: { title: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { sidebar, gutter } = useLayout();
  const web = Platform.OS === "web";
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + (sidebar ? 40 : space.xl),
        paddingBottom: space.xxl,
        paddingHorizontal: gutter,
        alignItems: web ? "stretch" : "center",
      }}
    >
      <View style={{ width: "100%", maxWidth: web ? CONTENT_MAX_WIDTH_WIDE : CONTENT_MAX_WIDTH, gap: space.lg }}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={[type.title, { color: t.text }]}>{title}</Text>
            {subtitle ? <Text style={[type.body, { color: t.text3, marginTop: 2 }]}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: ViewStyle; padded?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.border,
          padding: padded ? space.lg : 0,
        },
        Platform.select({
          web: { boxShadow: `0 1px 2px ${t.shadow}, 0 4px 16px ${t.shadow}` } as ViewStyle,
          default: { shadowColor: "#000", shadowOpacity: t.scheme === "dark" ? 0 : 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
        }),
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[type.overline, { color: t.text3, marginBottom: space.sm }]}>{children}</Text>;
}

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad";

export function toneColors(t: ReturnType<typeof useTheme>, tone: Tone) {
  switch (tone) {
    case "good": return { fg: t.good, bg: t.goodSoft };
    case "warn": return { fg: t.warn, bg: t.warnSoft };
    case "bad": return { fg: t.bad, bg: t.badSoft };
    case "accent": return { fg: t.accent, bg: t.accentSoft };
    default: return { fg: t.text2, bg: t.surface2 };
  }
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={[type.caption, { color: c.fg, fontWeight: "600" }]}>{children}</Text>
    </View>
  );
}

/** One number with a label and an optional supporting line. */
export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: Tone }) {
  const t = useTheme();
  const color = tone ? toneColors(t, tone).fg : t.text;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}${hint ? `. ${hint}` : ""}`} style={{ gap: 2 }}>
      <Text style={[type.label, { color: t.text3 }]}>{label}</Text>
      <Text style={[type.stat, { color, fontVariant: ["tabular-nums"] }]}>{value}</Text>
      {hint ? <Text style={[type.caption, { color: t.text3 }]}>{hint}</Text> : null}
    </View>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end", gap: space.md },
});
