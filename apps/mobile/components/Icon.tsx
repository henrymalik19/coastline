import { View } from "react-native";
import Svg, { Path, Polyline, Rect } from "react-native-svg";

export type IconName =
  | "home" | "plan" | "calendar" | "trend" | "check" | "info" | "sparkle"
  | "gear" | "plus" | "minus" | "trash" | "chevron" | "back" | "up" | "down" | "user" | "wallet" | "card" | "target" | "sliders" | "database" | "shield" | "edit" | "close";

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
      {name === "gear" && (
        <>
          <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" {...p} />
          <Path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" {...p} />
        </>
      )}
      {name === "plus" && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === "minus" && <Path d="M5 12h14" {...p} />}
      {name === "close" && <Path d="M6 6l12 12M18 6 6 18" {...p} />}
      {name === "edit" && (
        <>
          <Path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" {...p} />
          <Path d="m13.5 6.5 4 4" {...p} />
        </>
      )}
      {name === "trash" && (
        <>
          <Path d="M4 7h16M10 11v6M14 11v6" {...p} />
          <Path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" {...p} />
        </>
      )}
      {name === "chevron" && <Polyline points="9 6 15 12 9 18" {...p} />}
      {name === "back" && <Polyline points="15 6 9 12 15 18" {...p} />}
      {name === "up" && <Polyline points="6 15 12 9 18 15" {...p} />}
      {name === "down" && <Polyline points="6 9 12 15 18 9" {...p} />}
      {name === "user" && (
        <>
          <Path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" {...p} />
          <Path d="M4 21a8 8 0 0 1 16 0" {...p} />
        </>
      )}
      {name === "wallet" && (
        <>
          <Rect x="3" y="6" width="18" height="14" rx="2.5" {...p} />
          <Path d="M3 10h18M16 15h2" {...p} />
        </>
      )}
      {name === "card" && (
        <>
          <Rect x="3" y="5" width="18" height="14" rx="2.5" {...p} />
          <Path d="M3 10h18M7 15h4" {...p} />
        </>
      )}
      {name === "target" && (
        <>
          <Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" {...p} />
          <Path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" {...p} />
          <Path d="M12 12h.01" {...p} strokeWidth={3} />
        </>
      )}
      {name === "sliders" && <Path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4" {...p} />}
      {name === "database" && (
        <>
          <Path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z" {...p} />
          <Path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" {...p} />
        </>
      )}
      {name === "shield" && <Path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" {...p} />}
      {name === "sparkle" &&<Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" {...p} />}
    </Svg>
    </View>
  );
}
