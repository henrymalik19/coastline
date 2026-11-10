import { useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "../lib/layout";
import { CONTENT_MAX_WIDTH, CONTENT_MAX_WIDTH_WIDE, FORM_MAX_WIDTH, radius, space, type, useTheme } from "../lib/theme";
import { Icon } from "./Icon";
import { InfoText, InfoTip } from "./form";

/**
 * Scrolling page with a large title and safe-area padding. On the web the content
 * fills the available width (capped on huge monitors); native tablets keep a
 * phone-width column.
 */
export function Screen({
  title, subtitle, children, right, narrow, back, hideSettings, fill, maxWidth: maxWidthProp,
}: {
  title: string; subtitle?: string; children: ReactNode; right?: ReactNode;
  /** Forms and text: cap at a readable width instead of filling the screen. */
  narrow?: boolean;
  /** Show a back button (sub-pages). Pass a function to choose where it goes. */
  back?: boolean | (() => void);
  hideSettings?: boolean;
  /** Full-height page that doesn't scroll; its content scrolls internally (e.g. two-pane editors). */
  fill?: boolean;
  /** Override the content width cap. */
  maxWidth?: number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { sidebar, gutter } = useLayout();
  const web = Platform.OS === "web";
  const router = useRouter();
  const maxWidth = maxWidthProp ?? (narrow ? FORM_MAX_WIDTH : web ? CONTENT_MAX_WIDTH_WIDE : CONTENT_MAX_WIDTH);
  const headerRight = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      {right}
      {/* phones have no sidebar, so settings lives in the header */}
      {!sidebar && !hideSettings ? (
        <Pressable role="link" accessibilityLabel="Settings" hitSlop={8} onPress={() => router.push("/settings")} style={{ padding: 6 }}>
          <Icon name="gear" size={22} color={t.text2} />
        </Pressable>
      ) : null}
    </View>
  );
  const pad = { paddingTop: insets.top + (sidebar ? 40 : space.xl), paddingHorizontal: gutter, alignItems: "center" as const };
  const body = (
      <View style={{ width: "100%", maxWidth, gap: space.lg, ...(fill ? { flex: 1, minHeight: 0 } : null) }}>
        {back ? (
          <Pressable
            role="link"
            accessibilityLabel="Back"
            onPress={() => (typeof back === "function" ? back() : router.canGoBack() ? router.back() : router.replace("/settings"))}
            style={{ flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", marginLeft: -6, marginBottom: -8 }}
          >
            <Icon name="back" size={20} color={t.accent} />
            <Text style={[type.label, { color: t.accent }]}>Back</Text>
          </Pressable>
        ) : null}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text role="heading" aria-level={1} style={[type.title, { color: t.text }]}>{title}</Text>
            {subtitle ? <Text style={[type.body, { color: t.text3, marginTop: 2 }]}>{subtitle}</Text> : null}
          </View>
          {headerRight}
        </View>
        {children}
      </View>
  );
  // Web: every page shares the same frame, so the title sits in the same spot on every page.
  // A form page keeps its readable column, lined up on the left of that frame instead of centered.
  const framed = web && narrow && maxWidthProp === undefined ? (
    <View style={{ width: "100%", maxWidth: CONTENT_MAX_WIDTH_WIDE, alignItems: "flex-start", ...(fill ? { flex: 1, minHeight: 0 } : null) }}>{body}</View>
  ) : body;
  // plain conditional JSX (not an inline component) so inputs keep focus across renders
  return fill ? (
    <View style={[{ flex: 1, backgroundColor: t.bg, paddingBottom: Math.max(insets.bottom, space.lg) }, pad, gutterStyle]}>{framed}</View>
  ) : (
    <ScrollView style={[{ flex: 1, backgroundColor: t.bg }, gutterStyle]} contentContainerStyle={[pad, { paddingBottom: space.xxl }]}>
      {framed}
    </ScrollView>
  );
}

/**
 * Web: every page keeps room for a scrollbar, whether it scrolls or not, so a long page
 * doesn't sit a few px left of a short one.
 */
const gutterStyle = Platform.OS === "web" ? ({ overflowY: "auto", scrollbarGutter: "stable" } as ViewStyle) : null;

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
export function Stat({ label, value, hint, tone, info }: { label: string; value: string; hint?: string; tone?: Tone; /** ⓘ explanation */ info?: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const color = tone ? toneColors(t, tone).fg : t.text;
  return (
    <View accessible={!info} accessibilityLabel={info ? undefined : `${label}: ${value}${hint ? `. ${hint}` : ""}`} style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={[type.label, { color: t.text3, flexShrink: 1 }]}>{label}</Text>
        {info ? <InfoTip text={info} label={label} open={open} onToggle={setOpen} /> : null}
      </View>
      <Text style={[type.stat, { color, fontVariant: ["tabular-nums"] }]}>{value}</Text>
      {hint ? <Text style={[type.caption, { color: t.text3 }]}>{hint}</Text> : null}
      {info && open ? <View style={{ marginTop: space.xs }}><InfoText text={info} /></View> : null}
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
