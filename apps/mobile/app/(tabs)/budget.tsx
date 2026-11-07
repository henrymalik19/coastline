/**
 * Budget: every dollar gets a job. Money that comes in is ready to assign; you assign it to your
 * categories (budget items, bills, debt payments, savings), what you don't spend carries into next
 * month, and what you assign to savings and debts is what the plan counts as done that month.
 */
import { budgetCategories, budgetView, type BudgetCategory, type BudgetLine } from "@coastfi/engine";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, NumberInput } from "../../components/form";
import { Icon } from "../../components/Icon";
import { Card, Divider, Pill, Screen, SectionLabel } from "../../components/ui";
import { confirm } from "../../lib/confirm";
import { debtLabel } from "../../lib/debts";
import { money, monthLabel } from "../../lib/format";
import { useLayout } from "../../lib/layout";
import { usePlan } from "../../lib/plan";
import { monthKey, useStore } from "../../lib/store";
import { radius, space, type, useTheme } from "../../lib/theme";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nameOf = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const shift = (ym: string, n: number) => {
  const k = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
};
const between = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const ORDER: Record<BudgetCategory["kind"], number> = { spending: 0, bill: 1, debt: 2, saving: 3 };

export default function Budget() {
  const t = useTheme();
  const { contentWidth } = useLayout();
  const compact = contentWidth < 600;
  const { state, result, actual, start } = usePlan();
  const update = useStore((s) => s.update);
  const thisMonth = monthKey(start);
  const [month, setMonth] = useState(thisMonth);
  const [open, setOpen] = useState<string | null>(null);
  const b = state.budgetPlan;
  const cats = useMemo(() => budgetCategories(state, result.d, actual, start, month), [state, result, actual, start, month]);
  const view = budgetView(b, cats, month);
  const i = between(thisMonth, month);
  const expected = i >= 0 ? actual.months[i]?.income ?? 0 : 0;
  const entry = b?.months?.[month];
  const cashNow = state.accounts.filter((a) => a.type === "cash").reduce((s, a) => s + (+a.balance || 0), 0);

  const label = (c: BudgetCategory) => {
    if (c.key.startsWith("debt:")) {
      const x = state.debts.find((y) => "debt:" + y.id === c.key);
      return x ? debtLabel(x) : c.name;
    }
    return c.name;
  };

  /* ---------- changes ---------- */
  const edit = (fn: (e: NonNullable<NonNullable<typeof b>["months"][string]>) => void) =>
    update((p) => {
      if (!p.budgetPlan) return;
      const e = { ...(p.budgetPlan.months[month] ?? {}) };
      fn(e);
      p.budgetPlan.months = { ...p.budgetPlan.months, [month]: e };
    });
  const setAssigned = (k: string, v: number) => edit((e) => { e.assigned = { ...(e.assigned ?? {}), [k]: Math.max(0, v) }; });
  const setSpent = (k: string, v: number | undefined) =>
    edit((e) => {
      const sp = { ...(e.spent ?? {}) };
      if (v === undefined) delete sp[k];
      else sp[k] = v;
      e.spent = Object.keys(sp).length ? sp : undefined;
    });
  const setIncome = (v: number | undefined) => edit((e) => { e.income = v; });
  const fillFromPlan = () =>
    edit((e) => {
      const a = { ...(e.assigned ?? {}) };
      for (const c of cats) if (a[c.key] === undefined && c.target > 0.005) a[c.key] = Math.round(c.target * 100) / 100;
      e.assigned = a;
    });
  const startBudget = () =>
    update((p) => {
      p.budgetPlan = { start: thisMonth, startCash: Math.round(cashNow * 100) / 100, months: {} };
    });

  /* ---------- not started yet ---------- */
  if (!b) {
    return (
      <Screen title="Budget" subtitle={compact ? undefined : "Give every dollar a job"}>
        <Card style={{ gap: space.md }}>
          <Text style={[type.title, { color: t.text }]}>Start your monthly budget</Text>
          <Text style={[type.body, { color: t.text2 }]}>
            Each month, the money you have gets a job: bills, spending, debt payments and savings. What you don't spend stays put for next month. What you put toward savings and debts is what your plan counts as done.
          </Text>
          <Text style={[type.body, { color: t.text2 }]}>
            Your first money to assign is the cash in your accounts today: <Text style={{ color: t.text, fontWeight: "700" }}>{money(cashNow)}</Text>. Your categories come from your budget, bills, debts and savings, with amounts from your plan.
          </Text>
          <Button title={`Start with ${monthLabel(start, 0, true)}`} tone="primary" icon="plus" onPress={startBudget} style={{ alignSelf: "flex-start" }} />
        </Card>
      </Screen>
    );
  }

  /* ---------- the month ---------- */
  const groups: { name: string; kind: BudgetCategory["kind"]; cats: BudgetCategory[] }[] = [];
  for (const c of [...cats].sort((x, y) => ORDER[x.kind] - ORDER[y.kind])) {
    let g = groups.find((x) => x.name === c.group);
    if (!g) groups.push((g = { name: c.group, kind: c.kind, cats: [] }));
    g.cats.push(c);
  }
  const rta = view.readyToAssign;
  const unassigned = cats.filter((c) => entry?.assigned?.[c.key] === undefined && c.target > 0.005);
  const efCat = cats.find((c) => c.kind === "saving" && c.key.startsWith("acct:") && !c.moves);
  const canGoBack = month > b.start;

  const monthBar = (
    <View style={styles.monthBar}>
      <Pressable role="button" accessibilityLabel="Previous month" disabled={!canGoBack} onPress={() => setMonth(shift(month, -1))} hitSlop={8} style={[styles.navBtn, { borderColor: t.border, opacity: canGoBack ? 1 : 0.35 }]}>
        <Icon name="back" size={16} color={t.accent} />
      </Pressable>
      <View style={{ alignItems: "center", flex: 1 }}>
        <Text style={[type.heading, { color: t.text }]}>{nameOf(month)}</Text>
        {month === thisMonth ? (
          <Text style={[type.overline, { color: t.accent }]}>This month</Text>
        ) : (
          <Pressable role="button" onPress={() => setMonth(thisMonth)} hitSlop={6}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Back to this month</Text>
          </Pressable>
        )}
      </View>
      <Pressable role="button" accessibilityLabel="Next month" onPress={() => setMonth(shift(month, 1))} hitSlop={8} style={[styles.navBtn, { borderColor: t.border }]}>
        <Icon name="chevron" size={16} color={t.accent} />
      </Pressable>
    </View>
  );

  const rtaCard = (
    <Card style={{ gap: space.sm, borderColor: rta < -0.5 ? t.bad : rta > 0.5 ? t.good : t.border, backgroundColor: rta < -0.5 ? t.badSoft : t.surface }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 160 }}>
          <Text style={[type.label, { color: t.text3 }]}>Ready to assign</Text>
          <Text style={[type.display, { color: rta < -0.5 ? t.bad : rta > 0.5 ? t.good : t.text, fontVariant: ["tabular-nums"] }]}>{money(rta)}</Text>
          <Text style={[type.caption, { color: t.text3 }]}>
            {rta < -0.5 ? "You've assigned more than you have. Take some back from a category." : rta > 0.5 ? "Give it a job below." : "Every dollar has a job."}
            {view.assignedLater > 0.5 ? ` ${money(view.assignedLater)} is already assigned to later months.` : ""}
            {view.overspentBefore > 0.5 ? ` ${money(view.overspentBefore)} went to overspending in earlier months.` : ""}
          </Text>
        </View>
        <View style={{ gap: space.sm, alignItems: compact ? "flex-start" : "flex-end" }}>
          {unassigned.length ? <Button title="Fill from plan" icon="sparkle" tone="primary" onPress={fillFromPlan} style={{ minHeight: 36 }} /> : null}
          {rta > 0.5 && efCat ? (
            <Button title={`Rest to ${efCat.name}`} onPress={() => setAssigned(efCat.key, (entry?.assigned?.[efCat.key] ?? 0) + rta)} style={{ minHeight: 36 }} />
          ) : null}
        </View>
      </View>
      <Divider />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Text style={[type.label, { color: t.text }]}>Income received</Text>
          <Text style={[type.caption, { color: t.text3 }]}>
            {expected > 0.5 ? `Expected about ${money(expected)} this month` : "What came in this month"}
            {month === b.start ? ` · plus the ${money(b.startCash)} cash you started with` : ""}
          </Text>
        </View>
        {entry?.income === undefined && expected > 0.5 ? (
          <Button title={`Got ${money(expected)}`} icon="check" onPress={() => setIncome(Math.round(expected * 100) / 100)} style={{ minHeight: 36 }} />
        ) : null}
        <NumberInput kind="money" label={`Income received in ${nameOf(month)}`} value={entry?.income ?? 0} width={140} step={100} onChange={(v) => setIncome(v)} />
      </View>
    </Card>
  );

  const pill = (l: BudgetLine, c: BudgetCategory) => {
    const over = l.available < -0.005;
    const under = !over && c.target > 0.5 && l.assigned + 0.5 < c.target && c.kind !== "saving";
    const bg = over ? t.badSoft : under ? t.warnSoft : l.available > 0.5 ? t.goodSoft : t.surface2;
    const fg = over ? t.bad : under ? t.warn : l.available > 0.5 ? t.good : t.text3;
    return (
      <View style={[styles.pill, { backgroundColor: bg }]}>
        <Text style={[type.caption, { color: fg, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(l.available)}</Text>
      </View>
    );
  };

  const line = (c: BudgetCategory) => {
    const l = view.lines[c.key]!;
    const isOpen = open === c.key;
    const explicitSpent = entry?.spent?.[c.key] !== undefined;
    return (
      <View key={c.key}>
        <Pressable role="button" aria-expanded={isOpen} accessibilityLabel={`${label(c)}: ${money(l.available)} available`} onPress={() => setOpen(isOpen ? null : c.key)} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: t.surface2 } : null]}>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{label(c)}</Text>
            <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
              {money(l.assigned)} assigned · {money(l.spent)} {c.moves ? "paid" : "spent"}
              {c.target > 0.5 && Math.abs(l.assigned - c.target) > 0.5 ? ` · plan ${money(c.target)}` : ""}
            </Text>
          </View>
          {pill(l, c)}
        </Pressable>
        {isOpen ? (
          <View style={[styles.editor, { backgroundColor: t.surface2 }]}>
            <View style={styles.editRow}>
              <Text style={[type.caption, { color: t.text2, width: 70 }]}>Assigned</Text>
              <NumberInput kind="money" label={`${label(c)} assigned in ${nameOf(month)}`} value={l.assigned} width={140} step={25} onChange={(v) => setAssigned(c.key, v)} />
              {c.target > 0.5 && Math.abs(l.assigned - c.target) > 0.5 ? (
                <Button title={`Plan: ${money(c.target)}`} tone="ghost" onPress={() => setAssigned(c.key, Math.round(c.target * 100) / 100)} style={{ minHeight: 36 }} />
              ) : null}
            </View>
            <View style={styles.editRow}>
              <Text style={[type.caption, { color: t.text2, width: 70 }]}>{c.moves ? "Paid" : "Spent"}</Text>
              <NumberInput kind="money" label={`${label(c)} ${c.moves ? "paid" : "spent"} in ${nameOf(month)}`} value={l.spent} width={140} step={25} onChange={(v) => setSpent(c.key, v)} />
              {explicitSpent && c.moves ? <Button title="Same as assigned" tone="ghost" onPress={() => setSpent(c.key, undefined)} style={{ minHeight: 36 }} /> : null}
            </View>
            {l.available < -0.005 ? (
              <Button title={`Cover ${money(-l.available)} from ready to assign`} tone="primary" onPress={() => setAssigned(c.key, l.assigned - l.available)} style={{ minHeight: 36, alignSelf: "flex-start" }} />
            ) : null}
            <Text style={[type.caption, { color: t.text3 }]}>
              {l.carried > 0.5 ? `${money(l.carried)} carried over from last month. ` : ""}
              {c.kind === "saving" && c.moves
                ? "Counts as moved to the account when assigned (change Paid if you moved a different amount). Your plan uses what you assign here."
                : c.kind === "saving"
                  ? "Stays here and builds up. Your plan uses what you assign here."
                  : c.kind === "debt"
                    ? "Minimum plus any extra. What you assign beyond the minimum is your extra payment in the plan."
                    : c.kind === "bill"
                      ? "Builds up each month until the bill is due."
                      : "What you don't spend carries over to next month."}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen title="Budget" subtitle={compact ? undefined : "Give every dollar a job"}>
      {monthBar}
      {view.started ? (
        <>
          {rtaCard}
          {groups.map((g) => {
            const avail = g.cats.reduce((a, c) => a + view.lines[c.key]!.available, 0);
            const assigned = g.cats.reduce((a, c) => a + view.lines[c.key]!.assigned, 0);
            return (
              <Card key={g.name} padded={false}>
                <View style={[styles.groupHead, { borderBottomColor: t.border }]}>
                  <SectionLabel>{g.name}</SectionLabel>
                  <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]}>
                    {money(assigned)} assigned · <Text style={{ color: avail < -0.5 ? t.bad : t.text2, fontWeight: "700" }}>{money(avail)} available</Text>
                  </Text>
                </View>
                {g.cats.map((c, n) => (
                  <View key={c.key}>
                    {n > 0 ? <Divider /> : null}
                    {line(c)}
                  </View>
                ))}
              </Card>
            );
          })}
          <Text style={[type.caption, { color: t.text3 }]}>
            Categories come from your budget, bills (repeating goals), debts and savings. Add or rename them under Money. Transactions and bank import come next; for now, enter what you spent per category.
          </Text>
          <Button
            title="Start the budget over"
            tone="ghost"
            icon="trash"
            onPress={async () => {
              if (await confirm("Start the budget over?", "Everything you assigned, spent and received in the budget is cleared. Your plan, accounts and budget items stay.", "Start over")) update((p) => { delete p.budgetPlan; });
            }}
            style={{ alignSelf: "flex-start", minHeight: 36 }}
          />
        </>
      ) : (
        <Card>
          <Text style={[type.body, { color: t.text2 }]}>Your budget starts in {nameOf(b.start)}.</Text>
        </Card>
      )}
      {month === thisMonth && i === 0 ? <View style={{ height: 1 }} /> : <Pill tone="neutral">{i > 0 ? "A future month: assign ahead if you like" : "A past month"}</Pill>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", gap: space.md },
  navBtn: { borderWidth: 1, borderRadius: 999, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, flexWrap: "wrap", paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, minWidth: 72, alignItems: "flex-end" },
  editor: { gap: space.sm, marginHorizontal: space.md, marginBottom: space.md, padding: space.md, borderRadius: radius.md },
  editRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
});
