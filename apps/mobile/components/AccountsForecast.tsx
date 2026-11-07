/**
 * Every account the plan adds to: what goes in this month (and from where), this year against the
 * limit, and the balance ahead. Each one opens to the next 12–24 months, where any month can be changed.
 */
import { accountForecasts, BUCKET_LABELS, isHighInterest, paysExtra, type AccountForecast, type AccountKey, type PlanState, type RunResult } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money, monthLabel } from "../lib/format";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { NumberInput } from "./form";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressRing";
import { Card, Divider, SectionLabel } from "./ui";

type Props = { state: PlanState; o: RunResult; start: Date };

const ym = (start: Date, m: number) => {
  const dt = new Date(start.getFullYear(), start.getMonth() + m, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};

export function AccountsForecast({ state, o, start }: Props) {
  const t = useTheme();
  const update = useStore((s) => s.update);
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const pl = o.plan;
  const d = o.d;
  const all = accountForecasts(state, d, pl, d.r);
  const order = state.plan.steps;
  const by = state.plan.amountsBy ?? {};
  const coastM = o.crossing === null ? null : Math.round(o.crossing * 12);
  const retireM = Math.min(pl.months.length, d.years * 12) - 1;
  const ev = (k: string) => pl.events.find((e) => e.key === k);

  // the plan step a month's change goes to (null: set per paycheck, or not a step in your plan)
  const stepFor = (key: AccountKey, i: number): string | null => {
    const has = (k: string) => (order.includes(k as never) ? k : null);
    if (key === "k401") return null;
    if (key === "hsa") return state.plan.hsaPayroll !== false ? null : has("hsa");
    if (key === "cash") {
      const before = i === 0 ? d.bal.cash : pl.months[i - 1]!.cash;
      return before >= pl.starterTarget - 0.5 ? has("fullEF") ?? has("starterEF") : has("starterEF") ?? has("fullEF");
    }
    if (key === "debt") {
      const high = state.debts.filter((x) => paysExtra(x) && isHighInterest(x, state.plan.highApr) && x.balance > 0);
      const highLeft = high.some((x) => (ev("debt:" + x.id)?.m ?? 1e9) >= i);
      return highLeft ? has("highDebt") : has("lowDebt");
    }
    return has(key);
  };
  const setMonth = (step: string, month: string, v: number | undefined) =>
    update((p) => {
      const next = { ...(p.plan.amountsBy ?? {}) };
      const row = { ...(next[step] ?? {}) };
      if (v === undefined) delete row[month];
      else row[month] = Math.max(0, v);
      if (Object.keys(row).length) next[step] = row;
      else delete next[step];
      p.plan.amountsBy = Object.keys(next).length ? next : undefined;
    });

  const label = (k: AccountKey) =>
    k === "cash"
      ? "Cash (emergency fund)"
      : k === "debt"
        ? "Debts (what you owe)"
        : k.startsWith("goal:")
          ? `Goal: ${state.goals.find((g) => "goal:" + g.id === k)?.name ?? "Goal"}`
          : k === "ira"
            ? "IRA (Roth)"
            : BUCKET_LABELS[k as "k401" | "hsa" | "taxable"];
  // show accounts that have money or get some in the next two years
  const shown = all.filter((a) => a.start > 0.5 || a.months.slice(0, 24).some((m) => m.total > 0.5));
  const totalNow = shown.filter((a) => a.key !== "debt").reduce((s, a) => s + (a.months[0]?.total ?? 0), 0);
  const m0 = all.reduce(
    (s, a) => (a.key === "debt" ? { ...s, debt: s.debt + (a.months[0]?.total ?? 0) } : { pay: s.pay + (a.months[0]?.paycheck ?? 0), plan: s.plan + (a.months[0]?.plan ?? 0), emp: s.emp + (a.months[0]?.employer ?? 0), debt: s.debt }),
    { pay: 0, plan: 0, emp: 0, debt: 0 },
  );

  const parts = (m: { paycheck: number; plan: number; employer: number }, key: AccountKey) =>
    [
      m.paycheck > 0.5 ? `${money(m.paycheck)} from your paychecks` : "",
      m.plan > 0.5 ? `${m.paycheck > 0.5 ? "+" : ""}${money(m.plan)} ${key === "k401" || (key === "hsa" && state.plan.hsaPayroll !== false) ? "more per check from the plan" : "from what's left"}` : "",
      m.employer > 0.5 ? `${money(m.employer)} from your employer` : "",
    ].filter(Boolean).join(" · ");

  const card = (a: AccountForecast) => {
    const k = a.key;
    const m0a = a.months[0]!;
    const isOpen = open === k;
    const isDebt = k === "debt";
    const y0 = start.getFullYear();
    const thisYear = a.years.find((y) => y.year === y0);
    // money in before today (not in the plan): what you entered, else the plan's estimate from your paychecks
    const c = state.contributed && state.contributed.year === y0 ? state.contributed : undefined;
    const before = start.getMonth() === 0 ? 0 : k === "k401" ? c?.k401 ?? pl.ytdBefore?.k401 ?? 0 : k === "hsa" ? c?.hsa ?? pl.ytdBefore?.hsa ?? 0 : k === "ira" ? c?.ira ?? 0 : 0;
    const yearIn = thisYear ? (k === "hsa" ? thisYear.total : thisYear.employee) + before : 0;
    const guessed = start.getMonth() > 0 && !c && (k === "k401" || k === "hsa" || k === "ira");
    const at = (m: number) => a.months[Math.max(0, Math.min(a.months.length - 1, m))]!.balance;
    const points: { label: string; v: number }[] = [{ label: "Today", v: a.start }, { label: "In 1 year", v: at(11) }];
    if (a.invested) {
      if (coastM !== null && coastM > 12) points.push({ label: `Coast FI (${monthLabel(start, coastM)})`, v: at(coastM) });
      points.push({ label: `At ${d.retireAge}`, v: at(retireM) });
    }
    const paidOff = isDebt ? ev("debtFree") : undefined;
    const rows = a.months.slice(0, more ? 24 : 12);
    return (
      <View key={k}>
        <View style={{ padding: space.lg, gap: 6 }}>
          <Text style={[type.body, { color: t.text, fontWeight: "700" }]}>{label(k)}</Text>
          <Text style={[type.caption, { color: t.text2 }]}>
            <Text style={{ color: t.text, fontWeight: "600" }}>This month: {isDebt ? `${money(m0a.total)} extra` : money(m0a.total)}</Text>
            {m0a.total > 0.5 && !isDebt && k !== "cash" ? ` (${parts(m0a, k)})` : ""}
            {m0a.total <= 0.5 ? (() => { const f = a.months.findIndex((m) => m.total > 0.5); return f > 0 ? ` · starts ${monthLabel(start, f)}` : ""; })() : ""}
          </Text>
          {thisYear?.limit ? (
            <View style={{ gap: 4, maxWidth: 360 }}>
              <Text style={[type.caption, { color: t.text2 }]}>
                {y0}: {money(yearIn, { whole: true })} of the {money(thisYear.limit, { whole: true })} limit{k === "hsa" ? " (yours + employer's)" : ""}
                {guessed ? (k === "ira" ? " · add what you've put in this year (Money → Accounts)" : " · counts this year's earlier paychecks at today's amounts") : ""}
              </Text>
              <ProgressBar progress={Math.min(1, yearIn / thisYear.limit)} color={t.good} />
            </View>
          ) : null}
          <View style={styles.points}>
            {points.map((p) => (
              <View key={p.label} style={{ minWidth: 92 }}>
                <Text style={[type.caption, { color: t.text3 }]}>{p.label}</Text>
                <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(p.v, { whole: true })}</Text>
              </View>
            ))}
            {paidOff ? (
              <View style={{ minWidth: 92 }}>
                <Text style={[type.caption, { color: t.text3 }]}>Debt-free</Text>
                <Text style={[type.label, { color: t.good, fontWeight: "700" }]}>{monthLabel(start, paidOff.m)}</Text>
              </View>
            ) : null}
          </View>
          <Pressable role="button" aria-expanded={isOpen} onPress={() => { setOpen(isOpen ? null : k); setEdit(null); }} hitSlop={6} style={styles.link}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{isOpen ? "Hide months" : "Month by month"}</Text>
            <View style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}>
              <Icon name="chevron" size={14} color={t.accent} />
            </View>
          </Pressable>
          {isOpen ? (
            <View style={[styles.sched, { backgroundColor: t.surface2 }]}>
              <View style={styles.row}>
                <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Month</Text>
                <Text style={[type.overline, { color: t.text3, width: 96, textAlign: "right" }]}>{isDebt ? "Extra" : "In"}</Text>
                <Text style={[type.overline, { color: t.text3, width: 104, textAlign: "right" }]}>{isDebt ? "Still owed" : "Balance"}</Text>
              </View>
              {rows.map((m, i) => {
                const step = stepFor(k, i);
                const month = ym(start, m.m);
                const own = step ? by[step]?.[month] : undefined;
                const id = `${k}@${month}`;
                const editing = edit === id && !!step;
                const row = pl.months[i]!;
                const notes = [row.extraCheck ? "3 paychecks" : "", own !== undefined ? "changed" : "", own !== undefined && own > m.total + 0.5 && k !== "cash" ? `only ${money(m.total)} was left` : ""].filter(Boolean);
                const inText = money(k === "cash" || isDebt ? m.total : m.total);
                return (
                  <View key={m.m} style={{ gap: 4 }}>
                    <View style={styles.row}>
                      <Text style={[type.caption, { color: i === 0 ? t.text : t.text2, flex: 1, fontWeight: i === 0 ? "700" : "400" }]}>
                        {i === 0 ? `This month (${monthLabel(start, 0)})` : monthLabel(start, m.m)}
                        {notes.length ? <Text style={{ color: own !== undefined ? t.accent : t.text3 }}> · {notes.join(" · ")}</Text> : null}
                      </Text>
                      {step ? (
                        <Pressable role="button" accessibilityLabel={`Change ${label(k)} for ${monthLabel(start, m.m)}`} onPress={() => setEdit(editing ? null : id)} hitSlop={6} style={{ width: 96, alignItems: "flex-end" }}>
                          <Text style={[type.caption, { color: t.accent, fontWeight: "700", fontVariant: ["tabular-nums"], textDecorationLine: "underline" }]}>{inText}</Text>
                        </Pressable>
                      ) : (
                        <Text style={[type.caption, { color: t.text, width: 96, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{inText}</Text>
                      )}
                      <Text style={[type.caption, { color: t.text2, width: 104, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{money(m.balance, { whole: true })}</Text>
                    </View>
                    {editing && step ? (
                      <View style={styles.editRow}>
                        <Text style={[type.caption, { color: t.text2 }]}>{monthLabel(start, m.m)} only:</Text>
                        <NumberInput kind="money" label={`${label(k)}, ${monthLabel(start, m.m)}`} value={own ?? (k === "cash" ? row.alloc.ef : m.total)} width={130} step={100} onChange={(v) => setMonth(step, month, v)} />
                        {own !== undefined ? (
                          <Pressable role="button" onPress={() => { setMonth(step, month, undefined); setEdit(null); }} hitSlop={6}>
                            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Back to the plan</Text>
                          </Pressable>
                        ) : null}
                        <Pressable role="button" onPress={() => setEdit(null)} hitSlop={6}>
                          <Text style={[type.caption, { color: t.text3, fontWeight: "700" }]}>Done</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
              <Pressable role="button" onPress={() => setMore((v) => !v)} hitSlop={6} style={[styles.link, { marginTop: 4 }]}>
                <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{more ? "Show 12 months" : "Show 24 months"}</Text>
              </Pressable>
              <Text style={[type.caption, { color: t.text3, marginTop: 4 }]}>
                {k === "k401" || (k === "hsa" && state.plan.hsaPayroll !== false)
                  ? "Set per paycheck, so it's steady. Change it on your job (Money → Income) or with the order of your steps."
                  : "Tap an amount to change that month. That month it gets your amount first (if there's that much left after your budget), and the rest goes to your other steps."}
                {k === "cash" ? " Cash also collects anything not given to a step." : ""}
                {a.invested ? ` Balances grow at your assumed ${(d.r * 100).toFixed(1)}% return after inflation.` : ""}
              </Text>
            </View>
          ) : null}
        </View>
        <Divider />
      </View>
    );
  };

  return (
    <Card padded={false}>
      <View style={{ padding: space.lg, paddingBottom: space.md, gap: 4 }}>
        <SectionLabel>Accounts</SectionLabel>
        <Text style={[type.body, { color: t.text2 }]}>
          Going in this month: <Text style={{ color: t.text, fontWeight: "700" }}>{money(totalNow)}</Text>
          {[m0.pay > 0.5 ? `${money(m0.pay)} from your paychecks` : "", m0.plan > 0.5 ? `${money(m0.plan)} from the plan` : "", m0.emp > 0.5 ? `${money(m0.emp)} from employers` : ""].filter(Boolean).length
            ? ` (${[m0.pay > 0.5 ? `${money(m0.pay)} from your paychecks` : "", m0.plan > 0.5 ? `${money(m0.plan)} from the plan` : "", m0.emp > 0.5 ? `${money(m0.emp)} from employers` : ""].filter(Boolean).join(" · ")})`
            : ""}
          {m0.debt > 0.5 ? `, plus ${money(m0.debt)} extra on debt` : ""}. Open an account to see or change the next months.
        </Text>
      </View>
      <Divider />
      {shown.map(card)}
    </Card>
  );
}

const styles = StyleSheet.create({
  points: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, marginTop: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  sched: { borderRadius: radius.md, padding: space.sm, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 2 },
  editRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap", paddingBottom: 4 },
});
