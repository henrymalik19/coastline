import type { Band } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import { niceTicks } from "../lib/chart";
import { money } from "../lib/format";
import { CHART_FONT, type, useTheme } from "../lib/theme";

export type CompareLine = {
  /** Invested balance a month from now until retirement (series[0] = today). */
  series: ArrayLike<number>;
  /** Months until retirement on this line. */
  months: number;
  fire: number;
};

/**
 * Invested balance by age until retirement: your plan (teal) and, when a what-if is on, the what-if
 * (orange), with each one's FIRE number. `bands`: the range of market outcomes (simulated, by year) to
 * shade around the what-if line, or none. Tap or hover a year for its numbers.
 */
export function CompareChart({
  age, plan, what, bands, height = 260, selected, onSelect,
}: {
  age: number;
  plan: CompareLine;
  what?: CompareLine;
  bands?: Band[];
  height?: number;
  selected: number | null;
  onSelect: (year: number | null) => void;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const yearsOf = (l: CompareLine) => Math.max(0, Math.round(l.months / 12));
  const Y = Math.max(yearsOf(plan), what ? yearsOf(what) : 0);
  if (Y < 1)
    return (
      <View style={{ height: 120, alignItems: "center", justifyContent: "center" }}>
        <Text style={[type.body, { color: t.text3 }]}>Set a retirement age above your current age to see a projection.</Text>
      </View>
    );
  // a line by year: its balance at each birthday until its retirement
  const yearly = (l: CompareLine) => Array.from({ length: yearsOf(l) + 1 }, (_, i) => Number(l.series[Math.min(i * 12, l.series.length - 1)] ?? 0));
  const p = yearly(plan);
  const w = what ? yearly(what) : null;
  const shown = bands?.slice(0, Y + 1);
  const peak = Math.max(...p, ...(w ?? []), plan.fire, what?.fire ?? 0, ...(shown ?? []).map((b) => b.p75));
  const ticks = niceTicks(peak * 1.05);
  const top = ticks[ticks.length - 1]!;
  const M = { l: 56, r: 12, t: 18, b: 28 };
  const pw = Math.max(0, width - M.l - M.r);
  const ph = height - M.t - M.b;
  const x = (yr: number) => M.l + (yr / Y) * pw;
  const y = (v: number) => M.t + (1 - Math.min(v, top * 1.02) / top) * ph;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = (lo: (b: Band) => number, hi: (b: Band) => number) =>
    shown ? path(shown.map(lo)) + shown.slice().reverse().map((b, i) => `L${x(shown.length - 1 - i).toFixed(1)},${y(hi(b)).toFixed(1)}`).join("") + "Z" : "";
  const every = Y > 30 ? 10 : 5;
  const fireDiffers = !!what && Math.abs(what.fire - plan.fire) > Math.max(1000, plan.fire * 0.01);
  const sel = selected !== null ? Math.min(selected, Y) : null;

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height }}
      role="img"
      aria-label={`Invested balance by age, from ${age} to ${age + Y}. Your plan: ${money(p[p.length - 1] ?? 0)} at ${age + p.length - 1}${w ? `; what if: ${money(w[w.length - 1] ?? 0)} at ${age + w.length - 1}` : ""}. FIRE number ${money(plan.fire)}.`}
    >
      {width > 0 ? (
        <>
          <Svg width={width} height={height} fontFamily={CHART_FONT}>
            {ticks.map((v) => (
              <G key={v}>
                <Line x1={M.l} x2={M.l + pw} y1={y(v)} y2={y(v)} stroke={t.border} />
                <SvgText x={M.l - 8} y={y(v) + 4} fontSize={11} fill={t.text3} textAnchor="end">{money(v, { compact: true })}</SvgText>
              </G>
            ))}
            {Array.from({ length: Y + 1 }, (_, i) =>
              (age + i) % every === 0 || i === 0 || i === Y ? (
                <SvgText key={i} x={x(i)} y={height - 8} fontSize={11} fill={t.text3} textAnchor="middle">{age + i}</SvgText>
              ) : null,
            )}
            {shown ? <Path d={area((b) => b.p10, (b) => b.p90)} fill={what ? t.warn : t.series.k401} opacity={0.1} /> : null}
            {shown ? <Path d={area((b) => b.p25, (b) => b.p75)} fill={what ? t.warn : t.series.k401} opacity={0.18} /> : null}
            <Line x1={M.l} x2={M.l + pw} y1={y(plan.fire)} y2={y(plan.fire)} stroke={t.good} strokeWidth={1.5} strokeDasharray="5 4" />
            {fireDiffers ? <Line x1={M.l} x2={M.l + pw} y1={y(what!.fire)} y2={y(what!.fire)} stroke={t.warn} strokeWidth={1.5} strokeDasharray="5 4" /> : null}
            <Path d={path(p)} fill="none" stroke={t.series.k401} strokeWidth={2.2} />
            {w ? <Path d={path(w)} fill="none" stroke={t.warn} strokeWidth={2.2} /> : null}
            {sel !== null ? <Line x1={x(sel)} x2={x(sel)} y1={M.t} y2={M.t + ph} stroke={t.text3} /> : null}
            {sel !== null && p[sel] !== undefined ? <Circle cx={x(sel)} cy={y(p[sel]!)} r={4} fill={t.series.k401} stroke={t.surface} strokeWidth={2} /> : null}
            {sel !== null && w?.[sel] !== undefined ? <Circle cx={x(sel)} cy={y(w[sel]!)} r={4} fill={t.warn} stroke={t.surface} strokeWidth={2} /> : null}
          </Svg>
          <View style={{ position: "absolute", left: M.l - pw / Y / 2, top: M.t, width: pw + pw / Y, height: ph, flexDirection: "row" }}>
            {Array.from({ length: Y + 1 }, (_, i) => (
              <Pressable
                key={i}
                accessibilityLabel={`Age ${age + i}: your plan ${p[i] !== undefined ? money(p[i]!, { whole: true }) : "retired"}${w ? `, what if ${w[i] !== undefined ? money(w[i]!, { whole: true }) : "retired"}` : ""}`}
                onPress={() => onSelect(selected === i ? null : i)}
                onHoverIn={() => onSelect(i)}
                onHoverOut={() => onSelect(null)}
                style={{ flex: 1, height: "100%" }}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}
