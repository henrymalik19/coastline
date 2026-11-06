import { View } from "react-native";
import Svg, { Path, Polyline, Rect } from "react-native-svg";

export type IconName = "home" | "plan" | "calendar" | "trend" | "check" | "info" | "sparkle";

/** Small stroke icon set (24px grid, 2px stroke), drawn with react-native-svg. */
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color: string }) {
  const p = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <View aria-hidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "home" && (
        <>
          <Path d="M3 10.5 12 3l9 7.5" {...p} />
          <Path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" {...p} />
        </>
      )}
      {name === "plan" && (
        <>
          <Path d="M9 6h11M9 12h11M9 18h11" {...p} />
          <Path d="M4 6h.01M4 12h.01M4 18h.01" {...p} strokeWidth={3} />
        </>
      )}
      {name === "calendar" && (
        <>
          <Rect x="3.5" y="5" width="17" height="15.5" rx="2.5" {...p} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" {...p} />
        </>
      )}
      {name === "trend" && (
        <>
          <Polyline points="3 17 9 11 13 15 21 7" {...p} />
          <Polyline points="15 7 21 7 21 13" {...p} />
        </>
      )}
      {name === "check" && <Polyline points="5 12.5 10 17.5 19 7" {...p} strokeWidth={2.5} />}
      {name === "info" && (
        <>
          <Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" {...p} />
          <Path d="M12 11v5M12 8h.01" {...p} />
        </>
      )}
      {name === "sparkle" && <Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" {...p} />}
    </Svg>
    </View>
  );
}
