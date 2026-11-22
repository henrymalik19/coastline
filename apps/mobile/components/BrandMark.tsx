import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { radius, useTheme } from "../lib/theme";

/** The Coastwise mark: two waves on an accent tile. One mark everywhere (start page, sign in, sidebar). */
export function BrandMark({ size = 36 }: { size?: number }) {
  const t = useTheme();
  const s = Math.round(size * 0.62);
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Path d="M2 10c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5-1" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" fill="none" />
        <Path d="M2 16c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5-1" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.6} />
      </Svg>
    </View>
  );
}
