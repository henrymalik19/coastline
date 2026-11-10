/**
 * Your priority order: where money your budget doesn't assign goes, step by step (emergency fund,
 * the full match, debts, HSA, IRA, 401(k), goals, brokerage). Lives in Settings → Priority order.
 */
import { isHighInterest, paysExtra } from "@coastfi/engine";
import { useState } from "react";
import { useRouter } from "expo-router";
import { budgetKeyFor } from "../lib/budgetLinks";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Chip, FormList, FormRow, InlineMoney, Segmented, Select } from "./form";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressRing";
import { Card, Divider, Pill, Screen, SectionLabel } from "./ui";
import { money, monthLabel } from "../lib/format";
import { useLayout } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { stepInfo, type StepInfo } from "../lib/steps";
import { monthKey, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";

export function PlanSteps() {
  const t = useTheme();
  const { twoColumn, contentWidth } = useLayout();
  // phones: tighter rows, and the long explanations fold away
  const compact = contentWidth < 600;
  const [howOpen, setHowOpen] = useState(false);
  // steps folded open to show their details, split and order buttons
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpenSteps((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const { state, result: o, start, actual } = usePlan();
  const router = useRouter();
  const thisMk = monthKey(start);
  const update = useStore((s) => s.update);

  // steps describe what you'll really do (no what-ifs), so they match Home's to-dos
  const real = { ...o, plan: actual };
  const infos = state.plan.steps.map((k) => stepInfo(k, state, real, start)).filter((x): x is StepInfo => !!x);
  // steps running now: the first unfinished one, plus the next ones while a step shares what's left
  const shares = state.plan.shares ?? {};
  // "Now": every step that gets money this month (several at once with shares, or when one finishes mid-month)
  const a0 = actual.months[0]?.alloc;
  const open = infos.filter((i) => !i.done && !i.skip);
  const firstOf = (pred: (k: string) => boolean) => open.find((i) => pred(i.key))?.key;
  const activeKeys = new Set<string>();
  if (a0) {
    const add = (k: string | undefined, amount: number) => { if (k && amount > 0.5) activeKeys.add(k); };
    add(firstOf((k) => k === "starterEF" || k === "fullEF"), a0.ef);
    add(firstOf((k) => k === "match"), a0.matchGain);
    add(firstOf((k) => k === "highDebt" || k === "lowDebt"), a0.debt);
    add(firstOf((k) => k === "hsa"), a0.hsa);
    add(firstOf((k) => k === "ira"), a0.ira);
    add(firstOf((k) => k === "k401"), a0.k401Step);
    add(firstOf((k) => k.startsWith("goal:")), a0.goals);
    add(firstOf((k) => k === "taxable"), a0.taxable);
  }
  if (!activeKeys.size && open[0]) activeKeys.add(open[0].key);
  /** What a step gets this month (from the plan as you'll really do it). */
  const gets = (k: string): number => {
    if (!a0) return 0;
    if (k === "starterEF" || k === "fullEF") return a0.ef;
    if (k === "match") return a0.matchGain;
    if (k === "highDebt" || k === "lowDebt") return a0.debt;
    if (k === "hsa") return a0.hsa;
    if (k === "ira") return a0.ira;
    if (k === "k401") return a0.k401Step;
    if (k.startsWith("goal:")) return a0.goals;
    if (k === "taxable") return a0.taxable;
    return 0;
  };
  /** The next step still open after this one (what a split shares with). */
  const nextOpen = (k: string) => {
    const at = open.findIndex((x) => x.key === k);
    return at >= 0 ? open[at + 1] : undefined;
  };
  const amounts = state.plan.amounts ?? {};
  const amountsBy = state.plan.amountsBy ?? {};
  /** A share (0–1) or a set amount per month; picking one clears the other. */
  const setSplit = (key: string, v: { share: number } | { amount: number }) =>
    update((p) => {
      const sh = { ...(p.plan.shares ?? {}) };
      const am = { ...(p.plan.amounts ?? {}) };
      const by = { ...(p.plan.amountsBy ?? {}) };
      delete sh[key];
      delete am[key];
      if ("amount" in v) am[key] = Math.max(0, v.amount);
      else if (v.share < 1) sh[key] = v.share;
      p.plan.shares = Object.keys(sh).length ? sh : undefined;
      p.plan.amounts = Object.keys(am).length ? am : undefined;
      p.plan.amountsBy = Object.keys(by).length ? by : undefined;
    });
  const move = (i: number, dir: -1 | 1) =>
    update((p) => {
      const s = p.plan.steps;
      const j = i + dir;
      if (j < 0 || j >= s.length) return;
      [s[i], s[j]] = [s[j]!, s[i]!];
    });

  // when each step starts getting money (month index), for the date labels between steps
  const months = actual.months;
  const firstMonth = (pred: (m: (typeof months)[number], i: number) => boolean) => {
    const i = months.findIndex(pred);
    return i < 0 ? null : i;
  };
  const highEnd = Math.max(
    -1,
    ...state.debts.filter((x) => paysExtra(x) && isHighInterest(x, state.plan.highApr) && x.balance > 0).map((x) => actual.events.find((e) => e.key === "debt:" + x.id)?.m ?? 1e9),
  );
  const startOf = (key: string): number | null => {
    if (key === "starterEF") return 0;
    if (key === "fullEF") return firstMonth((m, i) => m.alloc.ef > 0.5 && (i === 0 ? o.d.bal.cash : months[i - 1]!.cash) >= actual.starterTarget - 0.5);
    if (key === "match") return actual.events.find((e) => e.key === "match")?.m ?? null;
    if (key === "highDebt") return firstMonth((m) => m.alloc.debt > 0.5);
    if (key === "lowDebt") return firstMonth((m, i) => i > highEnd && m.alloc.debt > 0.5);
    if (key.startsWith("goal:")) return firstMonth((m) => m.alloc.goals > 0.5);
    if (key === "hsa" || key === "ira" || key === "k401" || key === "taxable") return actual.firstFund[key] ?? null;
    return null;
  };
  // the steps as stages: everything that starts in the same month sits together (side by side on
  // a wide screen), finished and skipped steps fold into one line at the top
  const finished = infos.filter((i) => i.done || i.skip);
  const stageMap = new Map<number, StepInfo[]>();
  for (const info of infos) {
    if (info.done || info.skip) continue;
    const st = startOf(info.key);
    const k = st === null ? 1e9 : st;
    stageMap.set(k, [...(stageMap.get(k) ?? []), info]);
  }
  const stages = [...stageMap.entries()].sort((x, y) => x[0] - y[0]);
  const [doneOpen, setDoneOpen] = useState(false);
  const pad = compact ? space.md : space.lg;

  /** Details, split and order for one step (shown under its stage when you tap it). */
  const details = (info: StepInfo) => {
    const i = infos.indexOf(info);
    const canShare = !info.done && !info.skip && info.key !== "taxable" && info.key !== "match" && i < infos.length - 1;
    const idx = state.plan.steps.indexOf(info.key);
    const canAmount = canShare && info.key !== "k401" && !(info.key === "hsa" && state.plan.hsaPayroll !== false);
    const amt = canAmount ? amounts[info.key] : undefined;
    const changed = Object.keys(amountsBy[info.key] ?? {}).length;
    const partner = nextOpen(info.key);
    const partnerName = partner ? partner.title : "the next steps";
    const parts = info.meta
      .replace(/ \(see (Plan → Forecast|the Accounts view)\)/g, "")
      .split(" · ")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => x.replace(/^./, (c) => c.toUpperCase()));
    const bk = info.done || info.skip ? null : budgetKeyFor(state, info.key, thisMk);
    const got = bk ? state.budgetPlan?.months?.[thisMk]?.assigned?.[bk] : undefined;
    const paycheck = !info.done && !info.skip && !bk && (info.key === "k401" || info.key === "match" || info.key === "hsa");
    const shareValue = amt !== undefined ? "amount" : String(shares[info.key] ?? 1);
    return (
      <View key={"more-" + info.key} style={[styles.more, { borderColor: t.border }]}>
        <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>{info.label}</Text>
        {parts.length ? (
          <FormList>
            {parts.map((d, j) => (
              <View key={j} style={styles.detailRow}>
                <Text style={[type.caption, { color: t.text2, flex: 1 }]}>{d}</Text>
              </View>
            ))}
          </FormList>
        ) : null}
        {bk || paycheck || canShare ? (
          <FormList>
            {bk || paycheck ? (
              <Pressable
                role="link"
                onPress={() => router.push(bk ? `/budget?focus=${encodeURIComponent(bk)}` : "/money/income")}
                style={({ pressed }) => [styles.linkRow, pressed ? { backgroundColor: t.surface2 } : null]}
              >
                <Text style={[type.body, { color: t.text, flex: 1 }]}>{paycheck ? "Set on your job" : "This month"}</Text>
                <Text style={[type.body, { color: t.accent, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>
                  {paycheck ? "Per paycheck" : !state.budgetPlan ? "Budget for it" : got !== undefined ? `${money(got)} assigned` : "Assign on Budget"}
                </Text>
                <Icon name="chevron" size={14} color={t.accent} />
              </Pressable>
            ) : null}
            {canShare ? (
              <FormRow label="Run alongside the next step" hint={shareValue === "1" ? "Off: this step finishes before the next one starts" : `The rest of what's left goes to ${partnerName} at the same time`}>
                <Select
                  plain
                  label={`${info.title}: run alongside the next step`}
                  value={shareValue}
                  options={[
                    { value: "1", label: "No, finish this first" },
                    { value: "0.75", label: "Yes, 75% here" },
                    { value: "0.5", label: "Yes, half here" },
                    { value: "0.25", label: "Yes, 25% here" },
                    ...(amt !== undefined ? [{ value: "amount", label: `Yes, ${money(amt, { whole: true })} a month here` }] : []),
                  ]}
                  onChange={(v) => { if (v !== "amount") setSplit(info.key, { share: Number(v) }); }}
                />
              </FormRow>
            ) : null}
            {canShare && amt !== undefined ? (
              <FormRow label="Each month" hint={changed ? `${changed} month${changed === 1 ? "" : "s"} changed on the Budget tab` : undefined}>
                <InlineMoney label={`${info.title}, amount a month`} value={amt} onChange={(v) => setSplit(info.key, { amount: v })} />
              </FormRow>
            ) : null}
          </FormList>
        ) : null}
        <View style={styles.chipRow}>
          <Chip title="Earlier in the order" icon="up" disabled={idx === 0} onPress={() => move(idx, -1)} />
          <Chip title="Later" icon="down" disabled={idx === state.plan.steps.length - 1} onPress={() => move(idx, 1)} />
        </View>
      </View>
    );
  };

  /** One step: its place in the order, a specific name, why it's there, and this month's amount. */
  const tile = (info: StepInfo, stageMonth: number) => {
    const i = infos.indexOf(info);
    const active = activeKeys.has(info.key);
    const isOpen = openSteps.has(info.key);
    const canShare = info.key !== "taxable" && info.key !== "match" && i < infos.length - 1;
    const amt = canShare ? amounts[info.key] : undefined;
    const share = shares[info.key] ?? 1;
    const partner = nextOpen(info.key);
    const splitNote = canShare && (amt !== undefined || share < 1) ? `${amt !== undefined ? money(amt, { whole: true }) + "/mo" : Math.round(share * 100) + "% of what's left"}, alongside ${partner ? partner.title : "the next steps"}` : "";
    const now = stageMonth === 0 && gets(info.key) > 0.5 ? gets(info.key) : 0;
    return (
      <Pressable
        key={info.key}
        role="button"
        aria-expanded={isOpen}
        accessibilityLabel={`Step ${i + 1}: ${info.title}. ${isOpen ? "Hide" : "Show"} details`}
        onPress={() => toggle(info.key)}
        style={({ pressed }) => [
          styles.tile,
          { borderColor: isOpen || active ? t.accent : t.border, backgroundColor: pressed ? t.surface2 : t.surface },
          compact ? { minWidth: "100%" as unknown as number } : null,
        ]}
      >
        <View style={styles.tileHead}>
          <View style={[styles.num, { backgroundColor: active ? t.accent : t.surface2 }]}>
            <Text style={[type.caption, { fontWeight: "700", color: active ? "#fff" : t.text2 }]}>{i + 1}</Text>
          </View>
          <Text style={[type.body, { fontWeight: "600", color: t.text, flex: 1 }]} numberOfLines={2}>{info.title}</Text>
          {info.action ? <Pill tone="bad">To do</Pill> : null}
          <View style={{ transform: [{ rotate: isOpen ? "-90deg" : "90deg" }], opacity: 0.7 }}>
            <Icon name="chevron" size={12} color={t.text3} />
          </View>
        </View>
        {info.why ? <Text style={[type.caption, { color: t.text3 }]}>{info.why}</Text> : null}
        {now ? <Text style={[type.caption, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(now, { whole: true })} this month</Text> : null}
        {splitNote ? <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{splitNote}</Text> : null}
        {info.progress !== undefined ? (
          <View style={{ marginTop: 2 }}>
            <ProgressBar progress={info.progress} color={t.good} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  const steps = (
    <Card padded={false}>
      <View style={{ padding: pad, paddingBottom: space.md, gap: 4 }}>
        <SectionLabel>Your priority order</SectionLabel>
        {compact && !howOpen ? (
          <Pressable role="button" aria-expanded={false} onPress={() => setHowOpen(true)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" }}>
            <Text style={[type.caption, { color: t.text2 }]}>What's left fills these in order, or side by side. <Text style={{ color: t.accent, fontWeight: "700" }}>How it works</Text></Text>
            <Icon name="chevron" size={12} color={t.accent} />
          </Pressable>
        ) : (
          <Text style={[compact ? type.caption : type.body, { color: t.text2 }]}>
            Whatever your budget doesn't assign fills these in order. Steps that run at the same time sit side by side: a step can take part of what's left while the rest keeps going down the list. Tap a step for its details, to split it, or to change the order.
          </Text>
        )}
      </View>
      {finished.length ? (
        <>
          <Divider />
          <Pressable role="button" aria-expanded={doneOpen} onPress={() => setDoneOpen(!doneOpen)} style={({ pressed }) => [styles.doneRow, { paddingHorizontal: pad }, pressed ? { backgroundColor: t.surface2 } : null]}>
            <View style={[styles.num, { backgroundColor: t.good }]}>
              <Icon name="check" size={14} color="#fff" />
            </View>
            <Text style={[type.caption, { color: t.text2, flex: 1 }]} numberOfLines={doneOpen ? undefined : 1}>
              <Text style={{ fontWeight: "700", color: t.text }}>Done{finished.some((x) => x.skip) ? " or skipped" : ""}: </Text>
              {finished.map((x) => (x.skip ? `${x.title} (skipped)` : x.title)).join(" · ")}
            </Text>
            <View style={{ transform: [{ rotate: doneOpen ? "-90deg" : "90deg" }], opacity: 0.7 }}>
              <Icon name="chevron" size={12} color={t.text3} />
            </View>
          </Pressable>
          {doneOpen ? <View style={{ paddingHorizontal: pad, paddingBottom: space.md, gap: space.sm }}>{finished.map((x) => details(x))}</View> : null}
        </>
      ) : null}
      {stages.map(([m, list]) => (
        <View key={"stage" + m}>
          <Divider />
          <View style={[styles.stage, { paddingHorizontal: pad }]}>
            <Text style={[type.overline, { color: m === 0 ? t.accent : t.text3 }]}>
              {m === 0 ? (list.length > 1 ? "Now, together" : "Now") : m >= 1e9 ? "Not reached in the plan" : `From ${monthLabel(start, m)}`}
            </Text>
            <View style={styles.tiles}>{list.map((info) => tile(info, m))}</View>
            {list.filter((info) => openSteps.has(info.key)).map((info) => details(info))}
          </View>
        </View>
      ))}
    </Card>
  );

  return steps;
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  step: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  moves: { flexDirection: "row", alignItems: "center" },
  more: { gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  tile: { flexGrow: 1, flexBasis: 220, minWidth: 220, maxWidth: "100%", borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 4 },
  tileHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  stage: { paddingVertical: space.md, gap: space.sm },
  doneRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.md },
  budgetLink: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  detailRow: { paddingHorizontal: space.md, paddingVertical: 10 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, minHeight: 50 },
  chipRow: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  moveBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  nowBox: { borderRadius: radius.md, padding: space.md, gap: 6, marginTop: space.sm },
  nowRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dateLabel: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 6 },
  cmp: { flexDirection: "row", gap: space.lg },
  cmpBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: "hidden" },
  cmpRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md },
  cmpDiff: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
});

