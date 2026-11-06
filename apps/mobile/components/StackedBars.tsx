import { BUCKETS, type Bucket } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { money } from "../lib/format";
import { niceTicks, total } from "../lib/chart";
import { type, useTheme } from "../lib/theme";

export type BarDatum = {
  key: string;
  /** Short x label ("Jan"), shown on quarter months. */
  label: string;
  /** Second x label line (the year), shown on January / first bar. */
  sub?: string;
  /** Full label for tooltips and screen readers ("January 2027"). */
  full: string;
  values: Record<Bucket, number>;
  /** ▲ marker (extra-paycheck month). */
  marker?: boolean;
};

const M = { l: 52, r: 8, t: 16, b: 36 };
const GAP = 2; // surface gap between stacked segments (px)

/**
 * Stacked monthly bars: one y-axis, thin bars, 2px gaps between segments, rounded
 * top end anchored to the baseline, recessive grid. Hover (web) or tap selects a
 * month; `onSelect` lets the parent show details.
 */
export function StackedBars({
  data, colors, height = 280, selected, onSelect, label,
}: {
  data: BarDatum[];
  colors: Record<Bucket, string>;
  height?: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
  label: string;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const n = data.length;
  const totals = data.map((d) => total(d.values));
  const ticks = niceTicks(Math.max(...totals, 1));
  const top = ticks[ticks.length - 1]!;
  const plotW = Math.max(0, width - M.l - M.r);
  const plotH = height - M.t - M.b;
  const bw = n ? plotW / n : 0;
  const barGap = Math.max(2, bw * 0.24);
  const y = (v: number) => M.t + (1 - v / top) * plotH;

  // x labels: year labels first, then month labels, dropping any that would collide
  const labelAt = new Map<number, "year" | "month">();
  const minGap = 40;
  const kept: number[] = [];
  const fits = (i: number) => kept.every((j) => Math.abs(i - j) * bw >= minGap);
  // later year starts win over the first bar's label (Jan 2027 beats Nov 2026 two bars before)
  const yearIdx = data.map((d, i) => (d.sub ? i : -1)).filter((i) => i >= 0);
  for (const i of [...yearIdx.filter((i) => i > 0), ...yearIdx.filter((i) => i === 0)]) if (fits(i)) { kept.push(i); labelAt.set(i, "year"); }
  if (bw >= 12) data.forEach((d, i) => { if (d.label && !labelAt.has(i) && fits(i)) { kept.push(i); labelAt.set(i, "month"); } });

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }} role="img" aria-label={label}>
      {width > 0 ? (
        <>
          <Svg width={width} height={height}>
            {ticks.map((v) => (
              <G key={v}>
                <Line x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} stroke={t.border} strokeWidth={1} />
                <SvgText x={M.l - 8} y={y(v) + 4} fontSize={11} fill={t.text3} textAnchor="end">
                  {money(v, { compact: true })}
                </SvgText>
              </G>
            ))}
            {data.map((d, i) => {
              const x = M.l + i * bw + barGap / 2;
              const w = Math.max(1, bw - barGap);
              const segs = BUCKETS.filter((k) => d.values[k] > 0.5);
              const dim = selected !== null && selected !== i;
              let acc = 0;
              return (
                <G key={d.key} opacity={dim ? 0.35 : 1}>
                  {segs.map((k, j) => {
                    const v = d.values[k];
                    const y1 = y(acc + v);
                    const y0 = y(acc) - (j > 0 ? GAP : 0);
                    acc += v;
                    const h = Math.max(0, y0 - y1);
                    const isTop = j === segs.length - 1;
                    const r = isTop ? Math.min(4, w / 2, h) : 0;
                    return r > 0 ? (
                      <Path
                        key={k}
                        d={`M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`}
                        fill={colors[k]}
                      />
                    ) : (
                      <Rect key={k} x={x} y={y1} width={w} height={h} fill={colors[k]} />
                    );
                  })}
                  {d.marker ? (
                    <SvgText x={x + w / 2} y={y(totals[i]!) - 5} fontSize={9} fill={t.text} textAnchor="middle">
                      ▲
                    </SvgText>
                  ) : null}
                  {labelAt.get(i) === "year" ? (
                    <>
                      <SvgText x={x + w / 2} y={height - 20} fontSize={11} fill={t.text2} textAnchor="middle">{d.label}</SvgText>
                      <SvgText x={x + w / 2} y={height - 6} fontSize={11} fill={t.text3} textAnchor="middle">{d.sub}</SvgText>
                    </>
                  ) : labelAt.get(i) === "month" ? (
                    <SvgText x={x + w / 2} y={height - 20} fontSize={11} fill={t.text2} textAnchor="middle">{d.label}</SvgText>
                  ) : null}
                </G>
              );
            })}
          </Svg>
          {/* hit targets: full-height columns, wider than the bars (hover on web, tap everywhere) */}
          <View style={{ position: "absolute", left: M.l, top: M.t, width: plotW, height: plotH, flexDirection: "row" }}>
            {data.map((d, i) => (
              <Pressable
                key={d.key}
                accessibilityLabel={`${d.full}: ${money(totals[i]!)} saved and invested${d.marker ? ", extra paycheck month" : ""}`}
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

/** Legend: swatch + label in text ink (identity never by color alone). */
export function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
      {items.map((it) => (
        <View key={it.key} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: it.color }} />
          <Text style={[type.caption, { color: t.text2 }]}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
