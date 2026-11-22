import { coastNumberAt, type RunResult } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import { Button, Segmented } from "./form";
import { Legend } from "./StackedBars";
import { Card, SectionLabel } from "./ui";
import { niceTicks } from "../lib/chart";
import { money, monthLabel } from "../lib/format";
import type { HistoryPoint } from "../lib/history";
import { CHART_FONT, radius, space, type, useTheme } from "../lib/theme";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** About 4 round ticks covering min..max (not from zero), for the close-up. */
function rangeTicks(min: number, max: number): number[] {
  const span = Math.max(max - min, Math.abs(max) * 0.02, 1);
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((v) => v * mag).find((v) => v >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v < max + step; v += step) out.push(v);
  return out;
}

type Pt = { k: number; label: string; actual?: number; expected?: number; plan?: number; coast: number };

/**
 * Invested balance over time: what actually happened (solid, from your month-end records), where the
 * plan takes you from today (dashed), and your Coast FI number (where they meet, you can coast).
 * One y-axis. Tap or hover a month for its numbers; the table has them all.
 */
export function BalanceChart({ o, history, start, height = 260 }: { o: RunResult; history: HistoryPoint[]; start: Date; height?: number }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // recent: the last year up close, with what the plan expected each month; far: out to the Coast date
  const [range, setRange] = useState<"recent" | "far">(history.length > 2 ? "recent" : "far");
  const near = range === "recent" && history.length > 1;
  const d = o.d;
  const M = d.years * 12;
  const series = o.projSeries;
  const cross = o.crossing === null ? null : Math.round(o.crossing * 12);
  // ahead: to a couple of years past the Coast date (or 10 years), never past retirement
  const ahead = near ? Math.min(M, 6) : Math.max(12, Math.min(M, cross !== null ? cross + 24 : 120));
  const hist = near ? history.slice(-13) : history;
  const back = hist.length - 1;
  const coastAt = (k: number) => coastNumberAt(o.fire, d.r, Math.max(0, (M - k) / 12));
  const y0 = start.getFullYear();
  const m0 = start.getMonth();
  const lab = (k: number) => {
    const mm = m0 + k;
    const yy = y0 + Math.floor(mm / 12);
    return `${MON[((mm % 12) + 12) % 12]} ${yy}`;
  };
  const pts: Pt[] = [];
  for (let k = -back; k <= ahead; k++) {
    const h = k <= 0 ? hist[back + k] : undefined;
    pts.push({ k, label: lab(k), actual: h?.invested, expected: h?.expected, plan: k >= 0 ? series[k] : undefined, coast: coastAt(k) });
  }

  if (o.fire <= 0 || M <= 0) return null;

  const pad = { l: 52, r: 12, t: 14, b: 26 };
  const vals = pts.flatMap((p) => [p.actual, p.plan, p.expected, near ? undefined : p.coast]).filter((v): v is number => v !== undefined);
  const maxV = Math.max(...vals);
  const minV = near ? Math.min(...vals) : 0;
  const ticks = near ? rangeTicks(minV, maxV) : niceTicks(maxV * 1.05);
  const top = ticks[ticks.length - 1]!;
  const bottom = near ? ticks[0]! : 0;
  const pw = Math.max(0, width - pad.l - pad.r);
  const ph = height - pad.t - pad.b;
  const n = pts.length - 1 || 1;
  const x = (i: number) => pad.l + (i / n) * pw;
  const y = (v: number) => pad.t + (1 - (Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom || 1)) * ph;
  const path = (get: (p: Pt) => number | undefined) =>
    pts.reduce((acc, p, i) => {
      const v = get(p);
      if (v === undefined) return acc;
      return acc + `${acc ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    }, "");
  const today = back; // index of this month
  const ci = cross !== null && cross <= ahead ? today + cross : null;
  // labels: each January (thinned to fit); up close, every few months
  const yrs = pts.map((p, i) => ({ i, p })).filter(({ p }) => (near ? p.k % 3 === 0 : ((m0 + p.k) % 12 + 12) % 12 === 0));
  const step = Math.max(1, Math.ceil(yrs.length / Math.max(1, Math.floor(pw / 56))));
  const s = sel !== null ? pts[sel] : null;
  const legend = [
    ...(back > 0 ? [{ key: "a", label: "Actual", color: t.series.k401 }] : []),
    { key: "p", label: "Plan (dashed)", color: t.series.k401 },
    ...(near ? [{ key: "e", label: "Plan expected (○)", color: t.text3 }] : [{ key: "c", label: "Coast FI number", color: t.text2 }]),
  ];

  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <SectionLabel>Invested balance</SectionLabel>
          <Text style={[type.heading, { color: t.text, marginTop: -4, fontVariant: ["tabular-nums"] }]}>{money(d.invested)} now</Text>
        </View>
        <Button title={table ? "Show chart" : "By month"} tone="ghost" onPress={() => setTable((v) => !v)} />
      </View>
      {history.length > 1 ? (
        <View style={{ maxWidth: 260 }}>
          <Segmented label="Chart range" options={[{ value: "recent", label: "Recent" }, { value: "far", label: "To Coast" }]} value={range} onChange={(v) => { setRange(v); setSel(null); }} />
        </View>
      ) : null}
      <Legend items={legend} />
      {table ? (
        <ScrollView style={{ maxHeight: 360 }}>
          <View style={[styles.tr, { borderBottomColor: t.border }]}>
            {["Month", "Invested", "Plan", "Coast #"].map((h, i) => (
              <Text key={h} style={[styles.th, i ? styles.cn : styles.c0, { color: t.text3 }]}>{h}</Text>
            ))}
          </View>
          {pts
            .filter((p) => p.k <= 0 || p.k % 12 === 0 || p.k === cross)
            .map((p) => (
              <View key={p.k} style={[styles.tr, { borderBottomColor: t.border }]}>
                <Text style={[styles.td, styles.c0, { color: t.text }]}>{p.label}{p.k === 0 ? " (now)" : ""}</Text>
                <Text style={[styles.td, styles.cn, { color: t.text }]}>{p.actual !== undefined ? money(p.actual) : "–"}</Text>
                <Text style={[styles.td, styles.cn, { color: t.text2 }]}>{p.plan !== undefined && p.k > 0 ? money(p.plan, { whole: true }) : "–"}</Text>
                <Text style={[styles.td, styles.cn, { color: t.text2 }]}>{money(p.coast, { whole: true })}</Text>
              </View>
            ))}
        </ScrollView>
      ) : (
        <>
          <View
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            style={{ height }}
            role="img"
            aria-label={`Invested balance: ${money(d.invested, { whole: true })} now${cross !== null && cross > 0 ? `, meeting your Coast FI number in ${monthLabel(start, cross)}` : ""}. Use the table for each month.`}
          >
            {width > 0 ? (
              <>
                <Svg width={width} height={height} fontFamily={CHART_FONT}>
                  {ticks.map((v) => (
                    <G key={v}>
                      <Line x1={pad.l} x2={pad.l + pw} y1={y(v)} y2={y(v)} stroke={t.border} />
                      <SvgText x={pad.l - 8} y={y(v) + 4} fontSize={11} fill={t.text3} textAnchor="end">{money(v, { compact: true })}</SvgText>
                    </G>
                  ))}
                  {yrs.filter((_, j) => j % step === 0).map(({ i, p }) => (
                    <SvgText key={p.k} x={x(i)} y={height - 8} fontSize={11} fill={t.text3} textAnchor={x(i) > pad.l + pw - 24 ? "end" : x(i) < pad.l + 16 ? "start" : "middle"}>{near ? `${MON[((m0 + p.k) % 12 + 12) % 12]} '${String(y0 + Math.floor((m0 + p.k) / 12)).slice(2)}` : y0 + Math.floor((m0 + p.k) / 12)}</SvgText>
                  ))}
                  {/* today */}
                  {back > 0 ? <Line x1={x(today)} x2={x(today)} y1={pad.t} y2={pad.t + ph} stroke={t.border} strokeDasharray="2 3" /> : null}
                  {near ? null : <Path d={path((p) => p.coast)} fill="none" stroke={t.text2} strokeWidth={2} strokeDasharray="6 4" />}
                  {near
                    ? pts.map((p, i) => (p.expected !== undefined ? <Circle key={`e${p.k}`} cx={x(i)} cy={y(p.expected)} r={4} fill={t.surface} stroke={t.text3} strokeWidth={2} /> : null))
                    : null}
                  <Path d={path((p) => (p.k >= 0 ? p.plan : undefined))} fill="none" stroke={t.series.k401} strokeWidth={2} strokeDasharray="6 4" />
                  {back > 0 ? <Path d={path((p) => p.actual)} fill="none" stroke={t.series.k401} strokeWidth={2} /> : null}
                  <Circle cx={x(today)} cy={y(d.invested)} r={4} fill={t.series.k401} stroke={t.surface} strokeWidth={2} />
                  {!near && ci !== null && cross! > 0 ? <Circle cx={x(ci)} cy={y(pts[ci]!.coast)} r={5} fill={t.text2} stroke={t.surface} strokeWidth={2} /> : null}
                  {sel !== null ? <Line x1={x(sel)} x2={x(sel)} y1={pad.t} y2={pad.t + ph} stroke={t.text3} /> : null}
                </Svg>
                <View style={{ position: "absolute", left: pad.l - pw / n / 2, top: pad.t, width: pw + pw / n, height: ph, flexDirection: "row" }}>
                  {pts.map((p, i) => (
                    <Pressable
                      key={p.k}
                      accessibilityLabel={`${p.label}: ${p.actual !== undefined ? `invested ${money(p.actual, { whole: true })}` : `plan ${money(p.plan ?? 0, { whole: true })}`}`}
                      onPress={() => setSel(sel === i ? null : i)}
                      onHoverIn={() => setSel(i)}
                      onHoverOut={() => setSel(null)}
                      style={{ flex: 1, height: "100%" }}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </View>
          <View style={[styles.detail, { backgroundColor: t.surface2 }]} role="status">
            {s ? (
              <View style={styles.detailGrid}>
                <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>{s.label}{s.k === 0 ? " (now)" : ""}</Text>
                {s.actual !== undefined ? <Text style={[type.caption, { color: t.text2 }]}>Invested <Text style={{ color: t.text, fontWeight: "700" }}>{money(s.actual)}</Text></Text> : null}
                {s.expected !== undefined ? <Text style={[type.caption, { color: t.text2 }]}>Plan expected <Text style={{ color: t.text, fontWeight: "600" }}>{money(s.expected, { whole: true })}</Text></Text> : null}
                {s.plan !== undefined && s.k > 0 ? <Text style={[type.caption, { color: t.text2 }]}>Plan <Text style={{ color: t.text, fontWeight: "700" }}>{money(s.plan, { whole: true })}</Text></Text> : null}
                {near ? null : <Text style={[type.caption, { color: t.text2 }]}>Coast # <Text style={{ color: t.text, fontWeight: "600" }}>{money(s.coast, { whole: true })}</Text></Text>}
              </View>
            ) : (
              <Text style={[type.caption, { color: t.text3 }]}>{back > 0 ? "Tap a month to see its numbers." : "Tap a month to see its numbers. Your actual balance shows here from next month."}</Text>
            )}
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  detail: { borderRadius: radius.md, padding: space.md, minHeight: 44, justifyContent: "center" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: space.lg, rowGap: 4, alignItems: "center" },
  tr: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  th: { ...type.overline, paddingVertical: 8, paddingHorizontal: 6 },
  td: { ...type.caption, paddingVertical: 8, paddingHorizontal: 6, fontVariant: ["tabular-nums"] },
  c0: { flex: 1.4, minWidth: 0 },
  cn: { flex: 1, textAlign: "right" },
});
