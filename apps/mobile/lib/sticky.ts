import { Platform, type ViewStyle } from "react-native";

/**
 * A header that stays at the top while the list under it scrolls (web). `top` is how far down it
 * stops, below anything else that sticks; it needs its own background so rows slide under it.
 * Phones keep ordinary scrolling.
 */
export function sticky(top: number, background: string): ViewStyle | null {
  return Platform.OS === "web" ? ({ position: "sticky", top, zIndex: 3, backgroundColor: background } as unknown as ViewStyle) : null;
}

/** A bar that stays at the bottom while the page above it scrolls (web), until the page reaches it. */
export function stickyBottom(background: string): ViewStyle | null {
  return Platform.OS === "web" ? ({ position: "sticky", bottom: 0, zIndex: 3, backgroundColor: background } as unknown as ViewStyle) : null;
}
