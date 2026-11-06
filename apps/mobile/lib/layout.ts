import { Platform, useWindowDimensions } from "react-native";

/** Window width at which the web app swaps bottom tabs for a sidebar. */
export const SIDEBAR_BREAKPOINT = 768;
export const SIDEBAR_WIDTH = 248;

export type Layout = {
  /** Web on a tablet/desktop-sized window: sidebar instead of bottom tabs. */
  sidebar: boolean;
  /** Horizontal page padding. */
  gutter: number;
  /** Width available to page content (window minus sidebar and gutters). */
  contentWidth: number;
  /** Stat cards per row: 4 when they fit comfortably, else 2 (never 3 + 1). */
  statColumns: 2 | 4;
  /** Room to put two cards side by side (e.g. Coast FI card + to-dos). */
  twoColumn: boolean;
};

/**
 * One source of truth for responsive layout. Native apps always keep bottom tabs
 * (thumb-reachable); the web follows the window size.
 */
export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  const web = Platform.OS === "web";
  const sidebar = web && width >= SIDEBAR_BREAKPOINT;
  const gutter = width >= 1024 ? 40 : width >= 600 ? 24 : 16;
  const contentWidth = Math.min(1680, width - (sidebar ? SIDEBAR_WIDTH : 0) - gutter * 2);
  return {
    sidebar,
    gutter,
    contentWidth,
    statColumns: contentWidth >= 760 ? 4 : 2,
    twoColumn: contentWidth >= 860,
  };
}

/** Back-compat helper: true when the sidebar is shown. */
export const useIsWide = () => useLayout().sidebar;
