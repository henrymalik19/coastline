/**
 * Spending: what you spent, over the period you pick (this year, last year, the last 12 months, all
 * time, or a range of years), for all spending, a group, or a category (with its sub categories).
 * Every transaction you have counts, old ones from closed accounts too. A bar a month for a year or
 * less, a bar a year beyond. Tap a group or category in the list to show just it. Transfers, money in,
 * and card payments don't count (a card's purchases count where they were spent).
 */
import { spendingByMonth } from "@coastfi/engine";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Select } from "../../../components/form";
import { Icon } from "../../../components/Icon";
import { Card, Screen } from "../../../components/ui";
import { isoDay, useCategories } from "../../../lib/categories";
import { money } from "../../../lib/format";
import { usePlan } from "../../../lib/plan";
import { cardMap } from "../../../lib/register";
import { bars, buildItems, compareWith, inFocus, listFor, monthCount, periodRange, stackFor, stackValues, sumIn, type Focus, type ListRow, type Period } from "../../../lib/spending";
import { useStore } from "../../../lib/store";
import { radius, space, type, useTheme } from "../../../lib/theme";

const CHART_H = 120;
/** A bar's label: "$950", "$7.5k", "$15k". */
const short = (v: number) => (Math.abs(v) < 1000 ? `$${Math.round(v)}` : `$${(v / 1000).toFixed(Math.abs(v) < 10000 ? 1 : 0)}k`);

/** A share: "61%", or "<1%" for a sliver. */
const pct = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

const PERIODS = [
  { value: "thisYear", label: "This year" },
  { value: "lastYear", label: "Last year" },
  { value: "last12", label: "Last 12 months" },
  { value: "all", label: "All time" },
  { value: "years", label: "Choose years" },
] as const;
type PeriodKind = (typeof PERIODS)[number]["value"];

const focusValue = (f: Focus) => (f.kind === "all" ? "all" : f.kind === "group" ? "group:" + f.group : "cat:" + f.key);
const focusOf = (v: string): Focus => (v.startsWith("group:") ? { kind: "group", group: v.slice(6) } : v.startsWith("cat:") ? { kind: "cat", key: v.slice(4) } : { kind: "all" });

export default function Spending() {
  const t = useTheme();
  const { state, start } = usePlan();
  const txns = useStore((s) => s.txns);
  const cats = useCategories();
  const today = isoDay(start);
  const now = today.slice(0, 7);

  const items = useMemo(() => {
    const cards = new Set(Object.values(cardMap(state)));
    const linked = new Set(cats.filter((c) => c.account).map((c) => c.key));
    return buildItems(spendingByMonth(txns, (k) => cards.has(k) || linked.has(k), today), cats);
  }, [txns, cats, state, today]);
  const first = useMemo(() => items.reduce((m, i) => Object.keys(i.byMonth).reduce((a, k) => (k < a ? k : a), m), now), [items, now]);
  const years = useMemo(() => {
    const out: string[] = [];
    for (let y = Number(first.slice(0, 4)); y <= Number(now.slice(0, 4)); y++) out.push(String(y));
    return out;
  }, [first, now]);

  const [kind, setKind] = useState<PeriodKind>("thisYear");
  const [fromY, setFromY] = useState(years[0] ?? now.slice(0, 4));
  const [toY, setToY] = useState(now.slice(0, 4));
  const [focus, setFocus] = useState<Focus>({ kind: "all" });
  /** A month bar tapped: its amount shows above it. */
  const [tapped, setTapped] = useState<string | null>(null);

  const period: Period = kind === "years" ? { kind, from: fromY <= toY ? fromY : toY, to: fromY <= toY ? toY : fromY } : { kind };
  const range = periodRange(period, first, now);
  const months = monthCount(range);
  const shown = inFocus(items, focus);
  const total = sumIn(shown, range);
  const cmp = compareWith(period, range, first);
  const prior = cmp?.range;
  const priorTotal = prior ? sumIn(shown, prior) : 0;
  // per month, so a shorter stretch before (the start of your data) still compares fairly
  const change = prior && priorTotal > 0 ? total / months / (priorTotal / monthCount(prior)) - 1 : undefined;
  const chart = bars(shown, range);
  const max = Math.max(1, ...chart.map((b) => b.value));
  const list = listFor(items, focus, range);

  // what you can show: all spending, a group, or a category (sub categories under their parent)
  const focusOptions = useMemo(() => {
    const groups = [...new Set(items.map((i) => i.group))].sort();
    const name = (k: string) => items.find((i) => i.key === k)?.name ?? "";
    return [
      { value: "all", label: "All spending" },
      ...groups.map((g) => ({ value: "group:" + g, label: g, section: "Groups" })),
      ...groups.flatMap((g) =>
        items
          .filter((i) => i.group === g)
          .sort((a, b) => (a.parent ? name(a.parent) + " › " + a.name : a.name).localeCompare(b.parent ? name(b.parent) + " › " + b.name : b.name))
          .map((i) => ({ value: "cat:" + i.key, label: i.parent ? `${name(i.parent)} › ${i.name}` : i.name, section: g })),
      ),
    ];
  }, [items]);
  const focusName = focusOptions.find((o) => o.value === focusValue(focus))?.label ?? "All spending";
  // one step back out: a sub category to its parent, a category to its group, a group to everything
  const up: Focus | null = (() => {
    if (focus.kind === "all") return null;
    if (focus.kind === "group") return { kind: "all" };
    const i = items.find((x) => x.key === focus.key);
    return i?.parent ? { kind: "cat", key: i.parent } : i ? { kind: "group", group: i.group } : { kind: "all" };
  })();
  const upName = up ? (focusOptions.find((o) => o.value === focusValue(up))?.label ?? "All spending") : "";

  // the split bar: groups (all spending) or categories (a group)
  // the bars stack by group (all spending) or category (a group): the biggest 5 in color, the rest gray
  const stack = stackFor(items, focus, range);
  const colors = [t.series.k401, t.series.ira, t.series.taxable, t.series.ef, t.series.debt];
  const colorOf = (i: number) => (stack?.series[i]?.other ? t.text3 : colors[i % colors.length]!);
  const stackTotal = stack ? stack.series.reduce((a, x) => a + x.total, 0) : 0;
  const segs = (b: { key: string }) => {
    if (!stack) return null;
    const r = b.key.length === 4 ? { from: `${b.key}-01` < range.from ? range.from : `${b.key}-01`, to: `${b.key}-12` > range.to ? range.to : `${b.key}-12` } : { from: b.key, to: b.key };
    return stackValues(shown, stack, r);
  };

  const periodText = kind === "years" ? (period.kind === "years" && period.from !== period.to ? `${period.from}–${period.to}` : fromY) : PERIODS.find((p) => p.value === kind)!.label.toLowerCase();
  const priorText = cmp?.label ?? "";

  const row = (r: ListRow, depth = 0) => (
    <View key={r.key}>
      <Pressable
        role={r.focus ? "button" : undefined}
        disabled={!r.focus}
        onPress={() => r.focus && setFocus(r.focus)}
        style={(st) => [styles.catRow, { paddingLeft: depth ? space.xl : space.sm, backgroundColor: st.pressed ? t.surface2 : "transparent" }]}
      >
        <Text style={[depth ? type.label : type.body, { color: depth ? t.text2 : t.text, flex: 1 }]} numberOfLines={1}>
          {r.name}
          {r.archived ? <Text style={{ color: t.text3 }}> · archived</Text> : null}
        </Text>
        <Text style={[depth ? type.label : type.body, styles.num, { color: r.total < 0 ? t.good : depth ? t.text2 : t.text }]}>{money(r.total, { whole: true })}</Text>
        {r.focus ? <Icon name="chevron" size={14} color={t.text3} /> : <View style={{ width: 14 }} />}
      </Pressable>
      {r.subs?.map((s) => row(s, depth + 1))}
    </View>
  );

  return (
    <Screen title="Spending" subtitle="Every transaction you have, old ones from closed accounts too" narrow back="/money">
      {!items.length ? (
        <Card>
          <Text style={[type.body, { color: t.text2 }]}>No spending yet. It shows here once you have transactions with categories.</Text>
        </Card>
      ) : (
        <>
          {/* the filters: when, and what */}
          <Card style={{ gap: space.sm }}>
            <View style={styles.filters}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Select label="Period" value={kind} onChange={setKind} options={[...PERIODS]} />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Select label="Showing" value={focusValue(focus)} onChange={(v) => setFocus(focusOf(v))} options={focusOptions} />
              </View>
            </View>
            {kind === "years" ? (
              <View style={styles.filters}>
                <View style={{ flex: 1 }}>
                  <Select label="From" value={fromY} onChange={setFromY} options={years.map((y) => ({ value: y, label: y }))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Select label="To" value={toY} onChange={setToY} options={years.map((y) => ({ value: y, label: y }))} />
                </View>
              </View>
            ) : null}
          </Card>

          <Card style={{ gap: space.md }}>
            {up ? (
              <Pressable role="link" onPress={() => setFocus(up)} hitSlop={8} style={styles.back}>
                <View style={{ transform: [{ rotate: "180deg" }] }}><Icon name="chevron" size={12} color={t.accent} /></View>
                <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{upName}</Text>
              </Pressable>
            ) : null}
            <View style={{ gap: 2 }}>
              <Text style={[type.label, { color: t.text2 }]}>{focusName}, {periodText}</Text>
              <Text style={[type.title, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(total, { whole: true })}</Text>
              <Text style={[type.caption, { color: t.text2 }]}>
                About {money(total / months, { whole: true })}/mo{months < 12 && kind !== "thisYear" ? ` · ${months} months` : ""}
                {change !== undefined && Number.isFinite(change) ? ` · ${change >= 0 ? "up" : "down"} ${Math.abs(Math.round(change * 100))}% a month from ${priorText}` : ""}
              </Text>
            </View>

            {/* a bar a month (a year or less) or a year */}
            <View style={styles.chart}>
              {chart.map((b) => {
                const yearBar = b.key.length === 4;
                return (
                  <Pressable
                    key={b.key}
                    role="button"
                    accessibilityLabel={`${b.label}: ${money(b.value, { whole: true })}`}
                    // a year: see its months; a month: show its amount
                    onPress={() => (yearBar ? (setKind("years"), setFromY(b.key), setToY(b.key)) : setTapped(tapped === b.key ? null : b.key))}
                    style={styles.col}
                  >
                    <View style={styles.barArea}>
                      {chart.length <= 8 || tapped === b.key ? <Text style={[type.caption, styles.colValue, { color: tapped === b.key ? t.text : t.text2, fontWeight: tapped === b.key ? "700" : "400" }]} numberOfLines={1}>{short(b.value)}</Text> : null}
                      {(() => {
                        const dim = tapped && tapped !== b.key && !yearBar;
                        const parts = segs(b);
                        const h = Math.max(2, (Math.max(0, b.value) / max) * CHART_H);
                        if (!parts) return <View style={[styles.vbar, { height: h, backgroundColor: dim ? t.border : t.accent }]} />;
                        const pos = parts.map((v) => Math.max(0, v));
                        const sum = pos.reduce((a, v) => a + v, 0) || 1;
                        // stacked from the bottom, biggest series first; a thin gap between pieces
                        return (
                          <View style={[styles.vbar, { height: h, gap: 1, flexDirection: "column-reverse", overflow: "hidden", opacity: dim ? 0.35 : 1 }]}>
                            {pos.map((v, i) => (v > 0 ? <View key={i} style={{ flex: v / sum, backgroundColor: colorOf(i) }} /> : null))}
                          </View>
                        );
                      })()}
                    </View>
                    <Text style={[type.caption, { color: t.text2, fontSize: chart.length > 8 ? 10 : 12, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{b.label}</Text>
                    <Text style={[type.caption, { color: t.text3, fontSize: 10, lineHeight: 12 }]} numberOfLines={1}>{b.sub ?? " "}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[type.caption, { color: t.text3 }]}>{chart.some((b) => b.key.length === 4) ? "Tap a year to see its months." : chart.length > 8 ? "Tap a month to see its amount." : ""}</Text>

            {/* the legend: each color, and its share of the period */}
            {stack && stackTotal > 0 ? (
              <View style={styles.legend}>
                {stack.series.map((x, i) => (
                  <View key={x.key} style={styles.legendItem}>
                    <View style={[styles.swatch, { backgroundColor: colorOf(i) }]} />
                    <Text style={[type.caption, { color: t.text2 }]} numberOfLines={1}>{x.name} {pct(x.total / stackTotal)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>

          {list.length ? (
            <Card style={{ gap: space.md }}>
              {list.map((g) => (
                <View key={g.title ?? "list"} style={{ gap: 2 }}>
                  {g.title ? (
                    <Pressable role="button" onPress={() => setFocus({ kind: "group", group: g.title! })} style={[styles.groupHead, { borderBottomColor: t.border }]}>
                      <Text style={[type.body, { color: t.text, fontWeight: "700", flex: 1 }]} numberOfLines={1}>{g.title}</Text>
                      <Text style={[type.body, styles.num, { color: t.text, fontWeight: "700" }]}>{money(g.rows.reduce((a, r) => a + r.total, 0), { whole: true })}</Text>
                      <Icon name="chevron" size={14} color={t.text3} />
                    </Pressable>
                  ) : null}
                  {g.rows.map((r) => row(r))}
                </View>
              ))}
              <Text style={[type.caption, { color: t.text3 }]}>
                Tap a group or category to show just it. Transfers, money in, and card payments don't count: a card's purchases count where they were spent.
              </Text>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  back: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  col: { flex: 1, alignItems: "center", gap: 2, minWidth: 0 },
  colValue: { fontVariant: ["tabular-nums"], fontSize: 10 },
  barArea: { height: CHART_H + 16, width: "100%", justifyContent: "flex-end", alignItems: "center", gap: 2 },
  vbar: { width: "72%", maxWidth: 36, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: space.md, rowGap: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  catRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6, paddingRight: 2, borderRadius: radius.sm },
  num: { textAlign: "right", fontVariant: ["tabular-nums"] },
});
