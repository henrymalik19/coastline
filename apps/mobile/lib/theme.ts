import { Platform, useColorScheme } from "react-native";

/**
 * Design tokens. Coastal look: sea-teal accent, sand (light) / night-ocean (dark)
 * surfaces. Status and chart series colors are unchanged (categorical slots are
 * colorblind-validated, in chart stacking order). Spacing is on a 4pt grid.
 */
const light = {
  bg: "#f7f3ec",
  surface: "#fffdf9",
  surface2: "#f0eadf",
  border: "#e7dfd2",
  text: "#0d1a22",
  text2: "#4b5862",
  text3: "#5f6a72",
  accent: "#0e7490",
  accentSoft: "#dff1f4",
  good: "#1b7f3b",
  goodSoft: "#e2f3e7",
  warn: "#a86b00",
  warnSoft: "#fbf0dc",
  bad: "#c23b3a",
  badSoft: "#fbe5e4",
  track: "#ece5d9",
  series: { k401: "#2a78d6", ira: "#eb6834", taxable: "#1baf7a", ef: "#eda100", debt: "#e87ba4", hsa: "#008300", goals: "#6250d6" },
  shadow: "rgba(40, 30, 15, 0.07)",
};

type Palette = typeof light;

const dark: Palette = {
  bg: "#0b1620",
  surface: "#12202c",
  surface2: "#1a2b39",
  border: "#24384a",
  text: "#eef3f6",
  text2: "#b9c6cf",
  text3: "#8a9aa6",
  accent: "#38b2c9",
  accentSoft: "#12313b",
  good: "#4cbc6c",
  goodSoft: "#17301f",
  warn: "#e0a63a",
  warnSoft: "#33270f",
  bad: "#e66767",
  badSoft: "#3a1b1b",
  track: "#1f3242",
  series: { k401: "#3987e5", ira: "#d95926", taxable: "#199e70", ef: "#c98500", debt: "#d55181", hsa: "#008300", goals: "#9085e9" },
  shadow: "rgba(0, 0, 0, 0.4)",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** SVG text doesn't inherit the page font on the web; give charts the system UI font. */
export const CHART_FONT = Platform.OS === "web" ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : undefined;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: "700" as const, letterSpacing: -0.6 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700" as const, letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: "600" as const },
  stat: { fontSize: 22, lineHeight: 28, fontWeight: "700" as const, letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
  caption: { fontSize: 12, lineHeight: 16 },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: "600" as const, letterSpacing: 0.6, textTransform: "uppercase" as const },
};

export type Theme = Palette & { scheme: "light" | "dark" };

export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { ...(scheme === "dark" ? dark : light), scheme };
}

/** Max content width so the layout stays phone-shaped on tablets and the web. */
export const CONTENT_MAX_WIDTH = 560;
/**
 * Web: content fills the space next to the sidebar up to this width, then centers.
 * Fills typical laptop/desktop screens (up to ~2000px windows) edge to edge; on
 * ultra-wide monitors it stops labels and numbers drifting thousands of px apart.
 */
export const CONTENT_MAX_WIDTH_WIDE = 1680;
/** Forms and text pages: a readable column, centered. */
export const FORM_MAX_WIDTH = 760;
