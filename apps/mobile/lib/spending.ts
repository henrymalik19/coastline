/**
 * The spending report's logic (app/(tabs)/money/spending.tsx): the period you pick, what you're
 * showing (all spending, a group, or a category with its sub categories), and the numbers for each.
 */
import type { PeriodSpending } from "@coastfi/engine";

/** One line of the report: a category here, an old YNAB category, or "No category". */
export type Item = {
  key: string;
  name: string;
  group: string;
  /** A sub category: its parent's key (it sits under it, in the parent's group). */
  parent?: string;
  archived?: boolean;
  /** Month ("2024-03") → spent. */
  byMonth: Record<string, number>;
};

export type CategoryInfo = { key: string; label: string; group: string; parent?: string; hidden?: boolean };

export const OLD_GROUP = "Old YNAB categories";
export const NONE_GROUP = "No category";

/** The report's lines from the month-by-month spending. */
export function buildItems(d: PeriodSpending, cats: CategoryInfo[]): Item[] {
  const byKey = new Map(cats.map((c) => [c.key, c]));
  const out: Item[] = [];
  for (const [key, byMonth] of Object.entries(d.byCat)) {
    const c = byKey.get(key);
    const p = c?.parent ? byKey.get(c.parent) : undefined;
    out.push({ key, name: c?.label ?? "A deleted category", group: (p ?? c)?.group ?? "Other", ...(p ? { parent: p.key } : {}), ...(c?.hidden ? { archived: true } : {}), byMonth });
  }
  for (const [name, byMonth] of Object.entries(d.byOriginal)) out.push({ key: "orig:" + name, name, group: OLD_GROUP, byMonth });
  if (Object.keys(d.uncategorized).length) out.push({ key: "none", name: "No category", group: NONE_GROUP, byMonth: d.uncategorized });
  return out;
}

export type Period = { kind: "thisYear" | "lastYear" | "last12" | "all" } | { kind: "years"; from: string; to: string };
export type Focus = { kind: "all" } | { kind: "group"; group: string } | { kind: "cat"; key: string };

import { addMonths, monthsBetween } from "@coastfi/engine";
export { addMonths };

/** The months a period covers (first and last, "2024-01"), within what you have: `first` to `now`. */
export function periodRange(p: Period, first: string, now: string): { from: string; to: string } {
  const y = now.slice(0, 4);
  let from: string;
  let to: string;
  switch (p.kind) {
    case "thisYear": from = `${y}-01`; to = now; break;
    case "lastYear": from = `${Number(y) - 1}-01`; to = `${Number(y) - 1}-12`; break;
    case "last12": from = addMonths(now, -11); to = now; break;
    case "all": from = first; to = now; break;
    case "years": from = `${p.from}-01`; to = `${p.to}-12`; break;
  }
  if (from < first) from = first;
  if (to > now) to = now;
  return { from, to: to < from ? from : to };
}

/** How many months from `from` to `to`, both counted. */
export const monthCount = (r: { from: string; to: string }) => monthsBetween(r.from, r.to) + 1;

/** The lines a focus covers: all, a group's, or a category and its sub categories. */
export function inFocus(items: Item[], f: Focus): Item[] {
  if (f.kind === "all") return items;
  if (f.kind === "group") return items.filter((i) => i.group === f.group);
  return items.filter((i) => i.key === f.key || i.parent === f.key);
}

/** Spent by these lines in these months. */
export const sumIn = (items: Item[], r: { from: string; to: string }) =>
  items.reduce((a, i) => a + Object.entries(i.byMonth).reduce((s, [m, v]) => (m >= r.from && m <= r.to ? s + v : s), 0), 0);

/** The chart's bars: a bar a month for up to a year, else a bar a year (with how many months each covers). */
export function bars(items: Item[], r: { from: string; to: string }): { label: string; sub?: string; value: number; key: string }[] {
  const n = monthCount(r);
  if (n <= 12) {
    const out = [];
    for (let m = r.from; m <= r.to; m = addMonths(m, 1)) {
      const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
      out.push({ key: m, label: d.toLocaleString([], { month: "short" }).slice(0, 3), sub: r.from.slice(0, 4) !== r.to.slice(0, 4) && (m.endsWith("-01") || m === r.from) ? m.slice(0, 4) : undefined, value: sumIn(items, { from: m, to: m }) });
    }
    return out;
  }
  const out = [];
  for (let y = Number(r.from.slice(0, 4)); y <= Number(r.to.slice(0, 4)); y++) {
    const yr = { from: `${y}-01` < r.from ? r.from : `${y}-01`, to: `${y}-12` > r.to ? r.to : `${y}-12` };
    const c = monthCount(yr);
    out.push({ key: String(y), label: String(y), sub: c < 12 ? `${c} mo` : undefined, value: sumIn(items, yr) });
  }
  return out;
}

/** What to compare a period with, and how to say it: the same months a year earlier (this year), else the same length of time just before. Null for all time, or with no data that early. */
export function compareWith(p: Period, r: { from: string; to: string }, first: string): { range: { from: string; to: string }; label: string } | null {
  if (p.kind === "all") return null;
  if (p.kind === "thisYear") {
    const back = { from: addMonths(r.from, -12), to: addMonths(r.to, -12) };
    return back.to < first ? null : { range: { from: back.from < first ? first : back.from, to: back.to }, label: `the same months of ${back.from.slice(0, 4)}` };
  }
  const b = before(r, first);
  if (!b) return null;
  const n = monthCount(r);
  const label = p.kind === "last12" ? "the 12 months before" : n === 12 && b.from.endsWith("-01") && monthCount(b) === 12 ? b.from.slice(0, 4) : n % 12 === 0 ? `the ${n / 12} years before` : "the time before";
  return { range: b, label };
}

/** The same length of time just before (to compare with), or null when there's no data that early. */
export function before(r: { from: string; to: string }, first: string): { from: string; to: string } | null {
  const n = monthCount(r);
  const to = addMonths(r.from, -1);
  const from = addMonths(r.from, -n);
  return to < first ? null : { from: from < first ? first : from, to };
}

/** The list under the chart: rows to tap into (groups, or categories), each with its total. */
export type ListRow = { key: string; name: string; total: number; archived?: boolean; focus?: Focus; subs?: ListRow[] };

export function listFor(items: Item[], f: Focus, r: { from: string; to: string }): { title?: string; rows: ListRow[] }[] {
  const nonzero = (x: ListRow) => Math.abs(x.total) >= 0.005;
  const byTotal = (a: ListRow, b: ListRow) => b.total - a.total;
  // a top-level line with its sub categories (each its own row), its total counting them
  const catRows = (list: Item[]): ListRow[] => {
    const tops = list.filter((i) => !i.parent || !list.some((x) => x.key === i.parent));
    return tops
      .map((i) => {
        const subs = list.filter((x) => x.parent === i.key).map((x) => ({ key: x.key, name: x.name, total: sumIn([x], r), archived: x.archived, focus: { kind: "cat", key: x.key } as Focus })).filter(nonzero).sort(byTotal);
        const own = sumIn([i], r);
        return { key: i.key, name: i.name, archived: i.archived, total: own + subs.reduce((a, s) => a + s.total, 0), focus: { kind: "cat", key: i.key } as Focus, ...(subs.length ? { subs } : {}) };
      })
      .filter(nonzero)
      .sort(byTotal);
  };
  if (f.kind === "cat") {
    const me = items.find((i) => i.key === f.key);
    const subs = items.filter((i) => i.parent === f.key);
    if (!me || !subs.length) return [];
    const rows = [{ key: me.key + ":own", name: `${me.name} itself`, total: sumIn([me], r) }, ...subs.map((x) => ({ key: x.key, name: x.name, total: sumIn([x], r), archived: x.archived, focus: { kind: "cat", key: x.key } as Focus }))].filter(nonzero).sort(byTotal);
    // only itself left (its sub categories spent nothing then): nothing to split
    return rows.length > 1 ? [{ rows }] : [];
  }
  if (f.kind === "group") return [{ rows: catRows(items.filter((i) => i.group === f.group)) }];
  const groups = [...new Set(items.map((i) => i.group))];
  return groups
    .map((g) => {
      const rows = catRows(items.filter((i) => i.group === g));
      return { title: g, total: rows.reduce((a, x) => a + x.total, 0), rows };
    })
    .filter((g) => g.rows.length)
    .sort((a, b) => b.total - a.total)
    .map(({ title, rows }) => ({ title, rows }));
}

/** Shares for the split bar: the biggest few, the rest as "Other". */
export function shares(rows: { name: string; total: number }[], keep = 5): { name: string; total: number; other?: boolean }[] {
  const pos = rows.filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  if (pos.length <= keep + 1) return pos;
  const rest = pos.slice(keep).reduce((a, x) => a + x.total, 0);
  return [...pos.slice(0, keep), { name: "Other", total: rest, other: true }];
}

/** What the chart's bars stack by: groups (all spending) or categories (a group); none for one category. */
export type Stack = { series: { key: string; name: string; total: number; other?: boolean }[]; seriesOf: (i: Item) => string };

export function stackFor(items: Item[], f: Focus, r: { from: string; to: string }, keep = 5): Stack | null {
  if (f.kind === "cat") return null;
  const shown = inFocus(items, f);
  const raw = f.kind === "all" ? (i: Item) => i.group : (i: Item) => i.parent ?? i.key;
  const totals = new Map<string, number>();
  for (const i of shown) totals.set(raw(i), (totals.get(raw(i)) ?? 0) + sumIn([i], r));
  const name = (k: string) => (f.kind === "all" ? k : (shown.find((i) => i.key === k)?.name ?? k));
  const ranked = [...totals].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
  if (ranked.length < 2) return null;
  const top = ranked.length <= keep + 1 ? ranked : ranked.slice(0, keep);
  const topKeys = new Set(top.map(([k]) => k));
  const series: Stack["series"] = top.map(([k, v]) => ({ key: k, name: name(k), total: v }));
  const rest = ranked.filter(([k]) => !topKeys.has(k)).reduce((a, [, v]) => a + v, 0);
  if (rest > 0) series.push({ key: "__other", name: "Other", total: rest, other: true });
  return { series, seriesOf: (i) => (topKeys.has(raw(i)) ? raw(i) : "__other") };
}

/** Each bar's amount per series (same order as the stack's series). */
export function stackValues(items: Item[], s: Stack, r: { from: string; to: string }): number[] {
  return s.series.map((x) => sumIn(items.filter((i) => s.seriesOf(i) === x.key), r));
}
