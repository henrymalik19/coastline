import { useColorScheme } from "react-native";

/**
 * Design tokens. Colors follow the prototype's palette (categorical slots are
 * colorblind-validated, in chart stacking order). Spacing is on a 4pt grid.
 */
const light = {
  bg: "#f6f5f2",
  surface: "#ffffff",
  surface2: "#f0efeb",
  border: "#e6e4de",
  text: "#0b0b0b",
  text2: "#52514e",
  text3: "#7a7873",
  accent: "#2a78d6",
  accentSoft: "#e3eefb",
  good: "#1b7f3b",
  goodSoft: "#e2f3e7",
  warn: "#a86b00",
  warnSoft: "#fbf0dc",
  bad: "#c23b3a",
  badSoft: "#fbe5e4",
  track: "#ebe9e4",
  series: { k401: "#2a78d6", ira: "#eb6834", taxable: "#1baf7a", ef: "#eda100", debt: "#e87ba4", hsa: "#008300", goals: "#6250d6" },
  shadow: "rgba(20, 20, 15, 0.06)",
};

type Palette = typeof light;

const dark: Palette = {
  bg: "#121211",
  surface: "#1b1b1a",
  surface2: "#252523",
  border: "#2f2f2c",
  text: "#f0efec",
  text2: "#c3c2b7",
  text3: "#929089",
  accent: "#4a94ec",
  accentSoft: "#1d2c40",
  good: "#4cbc6c",
  goodSoft: "#17301f",
  warn: "#e0a63a",
  warnSoft: "#33270f",
  bad: "#e66767",
  badSoft: "#3a1b1b",
  track: "#2a2a27",
  series: { k401: "#3987e5", ira: "#d95926", taxable: "#199e70", ef: "#c98500", debt: "#d55181", hsa: "#008300", goals: "#9085e9" },
  shadow: "rgba(0, 0, 0, 0.4)",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
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
