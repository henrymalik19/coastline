/**
 * Your priority order: where money your budget doesn't assign goes, step by step (emergency fund,
 * the full match, debts, HSA, IRA, 401(k), goals, brokerage). Lives in Settings → Priority order.
 */
import { accountGroup, isHighInterest, isSpouseIra, paysExtra, STEP_LABELS, type StepKey } from "@coastfi/engine";
import { useState } from "react";
import { useRouter } from "expo-router";
import { budgetKeyFor } from "../lib/budgetLinks";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Chip, FormList, FormRow, InlineMoney, NumberInput, Segmented, Select } from "./form";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressRing";
import { Card, Divider, Pill, Screen, SectionLabel } from "./ui";
import { money, monthLabel } from "../lib/format";
import { useLayout } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { stepInfo, type StepInfo } from "../lib/steps";
import { monthKey, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";

/** Steps you can turn off (the emergency fund, the match and high-interest debt always stay). */
const OFFABLE: StepKey[] = ["hsa", "ira", "iraSpouse", "k401", "lowDebt", "taxable"];
/** Where steps go when turned back on. */
const DEFAULT_ORDER: StepKey[] = ["starterEF", "match", "highDebt", "fullEF", "hsa", "ira", "iraSpouse", "k401", "lowDebt", "taxable"];

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
  /** Take a step out of the order (it waits under "Not used"), or put it back where it normally goes. */
  const turnOff = (key: StepKey) =>
    update((p) => {
      p.plan.steps = p.plan.steps.filter((s) => s !== key);
      if (p.plan.shares) delete p.plan.shares[key];
      if (p.plan.amounts) delete p.plan.amounts[key];
    });
  const turnOn = (key: StepKey) =>
    update((p) => {
      if (p.plan.steps.includes(key)) return;
      // just before the next step that normally comes after it, else at the end
      const later = DEFAULT_ORDER.slice(DEFAULT_ORDER.indexOf(key) + 1);
      const at = p.plan.steps.findIndex((s) => later.includes(s) || (s.startsWith("goal:") && later.includes("taxable")));
      p.plan.steps.splice(at < 0 ? p.plan.steps.length : at, 0, key);
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
  // finished and skipped steps first, then the rest by when they start: steps that start in the same
  // month share a line (side by side on a wide screen)
  const finished = infos.filter((i) => i.done && !i.skip);
  // "Not used": steps that can't be used now (no HSA-eligible plan) and steps you turned off
  const skipped = infos.filter((i) => i.skip);
  const hasSpouseIra = !!state.spouse && state.accounts.some((a) => isSpouseIra(state, a));
  const turnedOff = OFFABLE.filter((k) => !state.plan.steps.includes(k) && (k !== "iraSpouse" || hasSpouseIra));
  const investRest = state.plan.steps.includes("taxable");
  const stageMap = new Map<number, StepInfo[]>();
  for (const info of infos) {
    if (info.done || info.skip) continue;
    const st = startOf(info.key);
    const k = st === null ? 1e9 : st;
    stageMap.set(k, [...(stageMap.get(k) ?? []), info]);
  }
  const stages = [...stageMap.entries()].sort((x, y) => x[0] - y[0]);
  // why a step is never reached: nothing is ever left over, "invest the rest" sits above it, or the steps above use it all
  const poured = (m: (typeof months)[number]) => m.alloc.ef + m.alloc.debt + m.alloc.k401TakeHome + m.alloc.ira + m.alloc.hsa + m.alloc.taxable + m.alloc.goals;
  const anyLeft = months.some((m) => poured(m) > 0.5 || m.alloc.leftover > 0.5);
  const restAt = infos.findIndex((x) => x.key === "taxable");
  const restReached = restAt >= 0 && startOf("taxable") !== null;
  const notReachedWhy = (info: StepInfo): string =>
    !anyLeft
      ? "Your budget uses all your take-home, so nothing is left over for this"
      : restReached && infos.indexOf(info) > restAt
        ? "“Invest the rest” is above it and takes everything left"
        : `The steps above take everything left until you retire at ${o.d.retireAge}`;
  // a step whose account you don't have yet (the plan still counts the money there)
  const NEEDS: Record<string, { group: string; name: string }> = {
    ira: { group: "ira", name: "an IRA" },
    k401: { group: "k401", name: "a 401(k)" },
    hsa: { group: "hsa", name: "an HSA" },
    taxable: { group: "taxable", name: "a brokerage account" },
  };
  const missingAccount = (key: string): string | null => {
    const need = NEEDS[key];
    if (!need || state.accounts.some((a) => accountGroup(a) === need.group)) return null;
    return `You don't have ${need.name} in Accounts yet. Open one to follow this step, then add it in Money → Accounts.`;
  };
  // what's left after every step: kept as cash (the plan's last, fixed step)
  const year1 = months.slice(0, 12);
  const keptAvg = year1.length ? year1.reduce((a, m) => a + Math.max(0, m.alloc.leftover), 0) / year1.length : 0;
  const keptText = state.emergency?.active
    ? "Emergency mode is on: everything left stays as cash"
    : !investRest
      ? keptAvg > 0.5
        ? `Investing the rest is off, so about ${money(keptAvg, { whole: true })}/mo stays in checking and savings over the next year`
        : "Investing the rest is off, so whatever's left stays in checking and savings"
      : keptAvg > 0.5
      ? `About ${money(keptAvg, { whole: true })}/mo stays in checking and savings over the next year`
      : restReached
        ? "Nothing: “Invest the rest” takes whatever reaches it"
        : "Nothing left over: the steps above use it all";

  // steps that run together (a step sharing what's left with the next) share one number
  const stepNumber = new Map<string, number>();
  {
    let n = 0;
    let withNext = false;
    for (const info of infos) {
      if (!withNext) n++;
      stepNumber.set(info.key, n);
      const j = infos.indexOf(info);
      const splits = !info.done && !info.skip && info.key !== "taxable" && info.key !== "match" && j < infos.length - 1 && (amounts[info.key] !== undefined || (shares[info.key] ?? 1) < 1);
      withNext = splits;
    }
  }
  const groupSize = (k: string) => [...stepNumber.values()].filter((n) => n === stepNumber.get(k)).length;
  /** Later steps of a group (they show a line joining them to the group's number, not the number again). */
  const continues = (info: StepInfo) => {
    const j = infos.indexOf(info);
    return j > 0 && stepNumber.get(infos[j - 1]!.key) === stepNumber.get(info.key);
  };
  // nothing gets money this month: "Now" is the next step, but only if the plan ever reaches it
  if (!activeKeys.size && open[0] && startOf(open[0].key) !== null) activeKeys.add(open[0].key);
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
    const share = shares[info.key] ?? 1;
    const mode = amt !== undefined ? "amount" : share < 1 ? "share" : "off";
    // the row already says when a step isn't reached, so the details don't repeat it
    const status = parts.filter((x) => !/not reached/i.test(x));
    return (
      <View key={"more-" + info.key} style={[styles.more, { marginLeft: compact ? 48 : 60, marginRight: pad }]}>
        {status.length ? (
          <View style={{ gap: 2 }}>
            {status.map((d, j) => (
              <Text key={j} style={[type.caption, { color: t.text2 }]}>{d}</Text>
            ))}
          </View>
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
              <FormRow label="Run alongside the next step" hint={mode === "off" ? "Off: this step finishes before the next one starts" : `The rest of what's left goes to ${partnerName} at the same time`}>
                <Select
                  plain
                  label={`${info.title}: run alongside the next step`}
                  value={mode}
                  options={[
                    { value: "off", label: "No, finish this first" },
                    { value: "share", label: "Yes, a share of what's left" },
                    ...(canAmount ? [{ value: "amount", label: "Yes, a set amount a month" }] : []),
                  ]}
                  onChange={(v) => {
                    if (v === mode) return;
                    if (v === "off") setSplit(info.key, { share: 1 });
                    else if (v === "share") setSplit(info.key, { share: 0.5 });
                    // start from what it gets this month, rounded to $25 (at least $25)
                    else setSplit(info.key, { amount: Math.max(25, Math.round(gets(info.key) / 25) * 25) });
                  }}
                />
              </FormRow>
            ) : null}
            {canShare && mode === "share" ? (
              <FormRow label="Share for this step" hint={`${Math.round((1 - share) * 100)}% of what's left goes on to ${partnerName}`}>
                <View style={{ width: 120 }}>
                  <NumberInput
                    kind="percent"
                    label={`${info.title}, share of what's left`}
                    value={share}
                    max={0.95}
                    onChange={(v) => setSplit(info.key, { share: Math.min(0.95, Math.max(0.01, v)) })}
                  />
                </View>
              </FormRow>
            ) : null}
            {canShare && mode === "amount" ? (
              <FormRow
                label="Each month"
                hint={changed ? `${changed} month${changed === 1 ? "" : "s"} changed on the Budget tab` : `Up to this much; the rest goes on to ${partnerName}`}
              >
                <InlineMoney label={`${info.title}, amount a month`} value={amt ?? 0} onChange={(v) => setSplit(info.key, { amount: v })} />
              </FormRow>
            ) : null}
          </FormList>
        ) : null}
        <View style={styles.chipRow}>
          <Chip title="Move up" icon="up" disabled={idx === 0} onPress={() => move(idx, -1)} />
          <Chip title="Move down" icon="down" disabled={idx === state.plan.steps.length - 1} onPress={() => move(idx, 1)} />
          {OFFABLE.includes(info.key as StepKey) && !info.done ? <Chip title="Turn off" icon="close" onPress={() => turnOff(info.key as StepKey)} /> : null}
        </View>
      </View>
    );
  };

  /** One step as a row: its place in the order, its name, "Now", a split note and progress. */
  const row = (info: StepInfo) => {
    const i = infos.indexOf(info);
    const active = activeKeys.has(info.key);
    const isOpen = openSteps.has(info.key);
    const canShare = !info.done && !info.skip && info.key !== "taxable" && info.key !== "match" && i < infos.length - 1;
    const amt = canShare ? amounts[info.key] : undefined;
    const share = shares[info.key] ?? 1;
    const partner = nextOpen(info.key);
    const splitNote = canShare && (amt !== undefined || share < 1) ? `${amt !== undefined ? money(amt, { whole: true }) + "/mo" : Math.round(share * 100) + "% of what's left"}, alongside ${partner ? partner.title : "the next steps"}` : "";
    const dim = info.done || info.skip;
    // steps that run together: an accent edge on each, the number once, a line joining the rest to it
    const grouped = !dim && groupSize(info.key) > 1;
    const joined = grouped && continues(info);
    const n = stepNumber.get(info.key) ?? i + 1;
    return (
      <Pressable
        key={info.key}
        role="button"
        aria-expanded={isOpen}
        accessibilityLabel={`Step ${n}${grouped ? `, running together with ${groupSize(info.key) - 1} other step${groupSize(info.key) > 2 ? "s" : ""}` : ""}: ${info.title}. ${isOpen ? "Hide" : "Show"} details`}
        onPress={() => toggle(info.key)}
        style={({ pressed }) => [
          styles.step,
          { paddingHorizontal: pad },
          grouped ? { borderLeftWidth: 3, borderLeftColor: t.accent, paddingLeft: pad - 3, backgroundColor: t.accentSoft } : null,
          compact ? { gap: space.sm } : null,
          pressed ? { backgroundColor: t.surface2 } : null,
        ]}
      >
        {joined ? (
          <View style={[styles.num, { backgroundColor: "transparent" }]} aria-hidden>
            <View style={{ position: "absolute", top: -space.md - 2, bottom: 6, width: 2, backgroundColor: t.accent, borderRadius: 1 }} />
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.accent, position: "absolute", bottom: 2 }} />
          </View>
        ) : (
          <View style={[styles.num, { backgroundColor: info.done ? t.good : active || grouped ? t.accent : t.surface2 }]}>
            {info.done ? <Icon name="check" size={14} color="#fff" /> : <Text style={[type.caption, { fontWeight: "700", color: active || grouped ? "#fff" : t.text2 }]}>{n}</Text>}
          </View>
        )}
        <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text numberOfLines={1} style={[type.body, { fontWeight: "600", color: dim ? t.text3 : t.text, flexShrink: 1 }]}>{info.skip ? `${info.title} (skipped)` : info.title}</Text>
            {active ? <Pill tone="accent">Now</Pill> : null}
            {info.action ? <Pill tone="bad">To do</Pill> : null}
          </View>
          {splitNote ? <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]} numberOfLines={1}>{splitNote}</Text> : null}
          {!dim && startOf(info.key) === null ? <Text style={[type.caption, { color: t.text3 }]}>{notReachedWhy(info)}</Text> : null}
          {!dim && missingAccount(info.key) ? <Text style={[type.caption, { color: t.warn }]}>{missingAccount(info.key)}</Text> : null}
          {info.progress !== undefined && !info.done ? (
            <View style={{ maxWidth: 280, marginTop: 3 }}>
              <ProgressBar progress={info.progress} color={t.good} />
            </View>
          ) : null}
        </View>
        <View style={{ transform: [{ rotate: isOpen ? "-90deg" : "90deg" }], opacity: 0.7 }}>
          <Icon name="chevron" size={14} color={t.text3} />
        </View>
      </Pressable>
    );
  };

  /** Steps that share a line: side by side on a wide screen, stacked on a phone; details open underneath. */
  const line = (list: StepInfo[], key: string) => (
    <View key={key}>
      {compact ? (
        list.map((info, j) => (
          <View key={info.key}>
            {j > 0 ? <View style={{ marginLeft: 48 }}><Divider /></View> : null}
            {row(info)}
            {openSteps.has(info.key) ? details(info) : null}
          </View>
        ))
      ) : (
        <>
          <View style={{ flexDirection: "row" }}>
            {list.map((info, j) => (
              <View key={info.key} style={[{ flex: 1, minWidth: 0 }, j > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.border } : null]}>
                {row(info)}
              </View>
            ))}
          </View>
          {list.filter((info) => openSteps.has(info.key)).map((info) => details(info))}
        </>
      )}
    </View>
  );

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
            Whatever your budget doesn't assign fills these in order. Steps that run at the same time share a line: a step can take part of what's left while the rest keeps going down the list. Tap a step for its details, to split it, or to change the order. The dates show when each one starts.
          </Text>
        )}
      </View>
      <Divider />
      {finished.map((info, j) => (
        <View key={"done-" + info.key}>
          {j > 0 ? <View style={{ marginLeft: compact ? 48 : 60 }}><Divider /></View> : null}
          {line([info], "l-" + info.key)}
        </View>
      ))}
      {stages.map(([m, list]) => (
        <View key={"stage" + m}>
          <View style={[styles.dateLabel, { backgroundColor: t.surface2, paddingHorizontal: pad }]}>
            <Text style={[type.overline, { color: t.accent }]}>{m === 0 ? "This month" : m >= 1e9 ? "Not reached in the plan" : monthLabel(start, m)}</Text>
          </View>
          {m >= 1e9
            ? // steps that never start don't run together: one per line, in order
              list.map((info, j) => (
                <View key={"nr-" + info.key}>
                  {j > 0 ? <View style={{ marginLeft: compact ? 48 : 60 }}><Divider /></View> : null}
                  {line([info], "nr" + info.key)}
                </View>
              ))
            : line(list, "s" + m)}
        </View>
      ))}
      {/* the fixed last step: whatever is still left stays as cash (can't be moved or removed) */}
      <View style={[styles.dateLabel, { backgroundColor: t.surface2, paddingHorizontal: pad }]}>
        <Text style={[type.overline, { color: t.text3 }]}>Always last</Text>
      </View>
      <View style={[styles.step, { paddingHorizontal: pad }, compact ? { gap: space.sm } : null]} accessibilityLabel={`Always last: anything left is kept as cash. ${keptText}`}>
        <View style={[styles.num, { backgroundColor: t.surface2 }]}>
          <Icon name="wallet" size={14} color={t.text2} />
        </View>
        <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
          <Text style={[type.body, { fontWeight: "600", color: t.text }]}>Anything left: kept as cash</Text>
          <Text style={[type.caption, { color: t.text3 }]}>{keptText}</Text>
        </View>
      </View>
      {/* outside the order: steps that can't be used now, and steps you turned off */}
      {skipped.length || turnedOff.length ? (
        <>
          <View style={[styles.dateLabel, { backgroundColor: t.surface2, paddingHorizontal: pad }]}>
            <Text style={[type.overline, { color: t.text3 }]}>Not used</Text>
          </View>
          {[
            ...skipped.map((info) => ({ key: info.key, title: STEP_LABELS[info.key as keyof typeof STEP_LABELS] ?? info.title, why: info.meta.replace(/^Skipped: /, "").replace(/^./, (c) => c.toUpperCase()), off: false })),
            ...turnedOff.map((k) => ({
              key: k,
              title: k === "taxable" ? "Invest the rest in brokerage" : STEP_LABELS[k as keyof typeof STEP_LABELS],
              why: k === "taxable" ? "Turned off: whatever's left stays as cash instead" : "Turned off: the plan skips it",
              off: true,
            })),
          ].map((x, j) => (
            <View key={"off-" + x.key}>
              {j > 0 ? <View style={{ marginLeft: compact ? 48 : 60 }}><Divider /></View> : null}
              <View style={[styles.step, { paddingHorizontal: pad }, compact ? { gap: space.sm } : null]}>
                <View style={[styles.num, { backgroundColor: t.surface2 }]}>
                  <Icon name="minus" size={14} color={t.text3} />
                </View>
                <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                  <Text style={[type.body, { fontWeight: "600", color: t.text3 }]}>{x.title}</Text>
                  <Text style={[type.caption, { color: t.text3 }]}>{x.why}</Text>
                </View>
                {x.off ? <Chip title="Turn on" icon="plus" onPress={() => turnOn(x.key as StepKey)} /> : null}
              </View>
            </View>
          ))}
        </>
      ) : null}
    </Card>
  );

  return steps;
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  step: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  moves: { flexDirection: "row", alignItems: "center" },
  more: { gap: space.sm, paddingTop: space.sm, paddingBottom: space.md },
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

