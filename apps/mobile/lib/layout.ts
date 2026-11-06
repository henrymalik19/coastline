import { Platform, useWindowDimensions } from "react-native";

/** Width at which the web app switches from bottom tabs to a sidebar. */
export const SIDEBAR_BREAKPOINT = 900;
export const SIDEBAR_WIDTH = 248;

/**
 * Wide layout = web on a desktop-sized window. Native apps keep bottom tabs
 * (thumb-reachable), and so does the web on a phone-sized window.
 */
export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= SIDEBAR_BREAKPOINT;
}
