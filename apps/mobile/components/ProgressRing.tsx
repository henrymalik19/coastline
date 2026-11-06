import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTheme } from "../lib/theme";

/** Circular progress (0..1, clamped) with content centered inside. */
export function ProgressRing({
  progress, size = 132, stroke = 12, color, children, label,
}: { progress: number; size?: number; stroke?: number; color?: string; children?: ReactNode; label: string }) {
  const t = useTheme();
  const p = Math.max(0, Math.min(1, progress));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(p * 100) }}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.track} strokeWidth={stroke} fill="none" />
        {p > 0 ? (
          <Circle
            cx={size / 2} cy={size / 2} r={r}
            stroke={color ?? t.accent} strokeWidth={stroke} fill="none" strokeLinecap="round"
            strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p)}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

/** Thin horizontal progress bar. */
export function ProgressBar({ progress, color, height = 6 }: { progress: number; color?: string; height?: number }) {
  const t = useTheme();
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: t.track, overflow: "hidden" }}>
      <View style={{ width: `${p * 100}%`, height: "100%", borderRadius: height, backgroundColor: color ?? t.accent }} />
    </View>
  );
}
