import type { Band } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import { niceTicks } from "../lib/chart";
import { money } from "../lib/format";
import { CHART_FONT, type, useTheme } from "../lib/theme";

/**
 * Invested balance by age: 10–90% and 25–75% simulated bands, the median line,
 * the Coast FI curve and the FIRE line. One y-axis. Hover/tap a year for details.
 */
export function ProjectionChart({
  bands, coastCurve, fire, age, crossing, height = 320, onSelect, selected,
}: {
  bands: Band[];
  coastCurve: number[];
  fire: number;
  age: number;
  crossing: number | null;
  height?: number;
  selected: number | null;
  onSelect: (year: number | null) => void;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const Y = bands.length - 1;
  const roomy = width >= 560;
  const M = { l: 56, r: roomy ? 104 : 12, t: 18, b: 28 };
  if (Y < 1) {
    return (
      <View style={{ height: 120, alignItems: "center", justifyContent: "center" }}>
        <Text style={[type.body, { color: t.text3 }]}>Set a retirement age above your current age to see a projection.</Text>
      </View>
    );
  }
  const ticks = niceTicks(Math.min(Math.max(fire * 1.08, ...bands.map((b) => b.p75)), fire * 2.2));
  const top = ticks[ticks.length - 1]!;
  const pw = Math.max(0, width - M.l - M.r);
  const ph = height - M.t - M.b;
  const x = (yr: number) => M.l + (yr / Y) * pw;
  const y = (v: number) => M.t + (1 - Math.min(v, top * 1.02) / top) * ph;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = (lo: (b: Band) => number, hi: (b: Band) => number) =>
    line(bands.map(lo)) + bands.slice().reverse().map((b, i) => `L${x(Y - i).toFixed(1)},${y(hi(b)).toFixed(1)}`).join("") + "Z";
  const every = Y > 30 ? 10 : 5;
  const end = bands[Y]!;
  const labels = [
    { v: end.p50, text: `Median ${money(end.p50, { compact: true })}`, color: t.text },
    { v: fire, text: `FIRE ${money(fire, { compact: true })}`, color: t.text2 },
  ].sort((a, b) => b.v - a.v);
  let ly = -99;

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height }}
      role="img"
      aria-label={`Projected invested balance from age ${age} to ${age + Y}. Median ${money(end.p50)} at ${age + Y}; FIRE number ${money(fire)}. Use the table view for every year.`}
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
            {bands.map((_, i) =>
              (age + i) % every === 0 || i === 0 || i === Y ? (
                <SvgText key={i} x={x(i)} y={height - 8} fontSize={11} fill={t.text3} textAnchor="middle">{age + i}</SvgText>
              ) : null,
            )}
            <Path d={area((b) => b.p10, (b) => b.p90)} fill={t.series.k401} opacity={0.12} />
            <Path d={area((b) => b.p25, (b) => b.p75)} fill={t.series.k401} opacity={0.2} />
            <Line x1={M.l} x2={M.l + pw} y1={y(fire)} y2={y(fire)} stroke={t.text3} strokeWidth={1.5} strokeDasharray="5 4" />
            <Path d={line(coastCurve)} fill="none" stroke={t.series.ira} strokeWidth={2} />
            <Path d={line(bands.map((b) => b.p50))} fill="none" stroke={t.series.k401} strokeWidth={2} />
            {crossing !== null && crossing > 0 ? (
              <G>
                <Circle cx={x(crossing)} cy={y(coastCurve[0]! * Math.pow(coastCurve[Y]! / coastCurve[0]!, crossing / Y))} r={5} fill={t.series.ira} stroke={t.surface} strokeWidth={2} />
              </G>
            ) : null}
            {roomy
              ? labels.map((l) => {
                  const yy = Math.max(y(l.v) + 4, ly + 15);
                  ly = yy;
                  return <SvgText key={l.text} x={M.l + pw + 8} y={yy} fontSize={11} fill={l.color}>{l.text}</SvgText>;
                })
              : null}
            {selected !== null ? <Line x1={x(selected)} x2={x(selected)} y1={M.t} y2={M.t + ph} stroke={t.text3} /> : null}
            {selected !== null ? <Circle cx={x(selected)} cy={y(bands[selected]!.p50)} r={4} fill={t.series.k401} stroke={t.surface} strokeWidth={2} /> : null}
          </Svg>
          <View style={{ position: "absolute", left: M.l - pw / Y / 2, top: M.t, width: pw + pw / Y, height: ph, flexDirection: "row" }}>
            {bands.map((b, i) => (
              <Pressable
                key={i}
                accessibilityLabel={`Age ${age + i}: median ${money(b.p50)}`}
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
