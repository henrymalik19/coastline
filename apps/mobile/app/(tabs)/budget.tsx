/**
 * Budget: every dollar gets a job. Money that comes in is ready to assign; you assign it to your
 * categories (budget items, bills, debt payments, savings), what you don't spend carries into next
 * month, and what you assign to savings and debts is what the plan counts as done that month.
 */
import { budgetCategories, budgetView, type BudgetCategory, type BudgetLine, type Txn } from "@coastfi/engine";
import { TxnForm } from "../../components/TxnForm";
import { budgetAccounts, cardMap } from "../../lib/register";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, NumberInput, Select, TextField, ToggleRow } from "../../components/form";
import { MonthlyAmount } from "../../components/ScheduleEditor";
import { groupOf, groupOrder, moveGroup, moveItem, moveToGroup, UNGROUPED } from "../../lib/budgetOrder";
import { newId } from "../../lib/store";
import { useRouter } from "expo-router";
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
  const clearTxns = useStore((s) => s.clearTxns);
  const thisMonth = monthKey(start);
  const [month, setMonth] = useState(thisMonth);
  const [open, setOpen] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");
  const [moveAmt, setMoveAmt] = useState(0);
  const [groupDraft, setGroupDraft] = useState("");
  const router = useRouter();
  const b = state.budgetPlan;
  const cats = useMemo(() => budgetCategories(state, result.d, actual, start, month), [state, result, actual, start, month]);
  const txns = useStore((s) => s.txns);
  const cards = useMemo(() => cardMap(state), [state]);
  const view = budgetView(b, cats, month, { txns, cards });
  const [adding, setAdding] = useState<{ txn?: Txn; categoryId?: string; kind?: "out" | "in"; amount?: number } | null>(null);
  const monthTxns = txns.filter((x) => !x.deleted && x.date.startsWith(month));
  const accts = budgetAccounts(state);
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
  const itemIndex = (id: string) => state.budget.findIndex((x) => x.id === id);
  const editItem = (id: string, patch: Partial<(typeof state.budget)[number]>) =>
    update((p) => {
      const i = p.budget.findIndex((x) => x.id === id);
      if (i >= 0) p.budget[i] = { ...p.budget[i]!, ...patch };
    });
  const addItem = (group: string) => {
    const id = newId();
    update((p) => {
      const last = p.budget.map((x, i) => (groupOf(x) === group ? i : -1)).filter((i) => i >= 0).at(-1) ?? p.budget.length - 1;
      p.budget.splice(last + 1, 0, { id, name: "", amount: 0, inRetirement: true, group });
    });
    setOpen(id);
  };
  const addGroup = () => {
    // (the new group opens with its name ready to change)
    const names = new Set(groupOrder(state.budget));
    let name = "New group";
    for (let n = 2; names.has(name); n++) name = `New group ${n}`;
    addItem(name);
    setGroupOpen(name);
    setGroupDraft(name);
  };
  const renameGroup = (from: string, to: string) =>
    update((p) => {
      const name = to.trim();
      if (!name) return;
      p.budget.forEach((x) => { if (groupOf(x) === from) x.group = name; });
      p.debts.forEach((x) => { if (x.budgetGroup === from) x.budgetGroup = name; });
      p.goals.forEach((x) => { if (x.budgetGroup === from) x.budgetGroup = name; });
    });
  /** Move money between two categories this month. */
  const moveMoney = (from: string, to: string, amount: number) =>
    edit((e) => {
      const a = { ...(e.assigned ?? {}) };
      const take = Math.max(0, Math.min(amount, a[from] ?? 0));
      a[from] = (a[from] ?? 0) - take;
      a[to] = (a[to] ?? 0) + take;
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
        <View style={{ flex: 1, minWidth: 160 }}>
          <Text style={[type.label, { color: t.text }]}>Income received</Text>
          <Text style={[type.caption, { color: t.text3 }]}>
            Money in, filed to ready to assign{expected > 0.5 ? ` · about ${money(expected)} expected` : ""}
            {month === b.start ? ` · plus the ${money(b.startCash)} cash you started with` : ""}
          </Text>
          {(entry?.income ?? 0) > 0.005 ? (
            <Text style={[type.caption, { color: t.text3 }]}>
              Includes {money(entry!.income!)} entered before transactions.{" "}
              <Text role="button" onPress={() => setIncome(undefined)} style={{ color: t.accent, fontWeight: "700" }}>Remove it</Text>
            </Text>
          ) : null}
        </View>
        <Text style={[type.heading, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(view.income)}</Text>
        <Button
          title="Add income"
          icon="plus"
          onPress={() => setAdding({ kind: "in", categoryId: "ready", amount: Math.max(0, Math.round((expected - view.income) * 100) / 100) })}
          style={{ minHeight: 36 }}
        />
      </View>
    </Card>
  );

  const COLW = compact ? 64 : 104;
  const num = (v: number, color: string, bold = false) => (
    <Text style={[type.caption, { width: COLW, textAlign: "right", color, fontWeight: bold ? "700" : "500", fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
      {money(v, { whole: compact && Math.abs(v) >= 1000 })}
    </Text>
  );
  const pill = (l: BudgetLine, c: BudgetCategory) => {
    const over = l.available < -0.005;
    const under = !over && c.target > 0.5 && l.assigned + 0.5 < c.target && c.kind !== "saving";
    const bg = over ? t.badSoft : under ? t.warnSoft : l.available > 0.5 ? t.goodSoft : t.surface2;
    const fg = over ? t.bad : under ? t.warn : l.available > 0.5 ? t.good : t.text3;
    return (
      <View style={[styles.pill, { backgroundColor: bg }]}>
        <Text style={[type.caption, { color: fg, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(l.available, { whole: compact && Math.abs(l.available) >= 1000 })}</Text>
      </View>
    );
  };

  /** Change the category itself: name, plan amount, group, order (spending); target (savings); links (bills, debts). */
  const categoryEditor = (c: BudgetCategory) => {
    if (c.kind === "spending") {
      const it = state.budget.find((x) => x.id === c.key);
      if (!it) return null;
      const idx = itemIndex(it.id);
      const groups = groupOrder(state.budget);
      return (
        <View style={[styles.catBox, { borderTopColor: t.border }]}>
          <Text style={[type.overline, { color: t.text3 }]}>Category</Text>
          <TextField label="Name" placeholder="e.g. Groceries" value={it.name} onChange={(v) => editItem(it.id, { name: v })} />
          <View style={styles.editRow}>
            <Text style={[type.caption, { color: t.text2, width: 70 }]}>Each month</Text>
            <NumberInput kind="money" label={`${it.name || "Item"} planned each month`} value={it.amount} width={140} step={25} onChange={(v) => editItem(it.id, { amount: v })} />
            <Text style={[type.caption, { color: t.text3, flex: 1, minWidth: 120 }]}>What your plan expects; "Fill from plan" assigns it.</Text>
          </View>
          <ToggleRow label="Still paid after you retire" hint="Counts toward your retirement number" value={it.inRetirement} onChange={(v) => editItem(it.id, { inRetirement: v })} />
          <ToggleRow label="Essential" hint="Kept when emergency mode cuts to essentials" value={it.essential !== false} onChange={(v) => editItem(it.id, { essential: v })} />
          <View style={styles.editRow}>
            <Text style={[type.caption, { color: t.text2, width: 70 }]}>Group</Text>
            <View style={{ flex: 1, minWidth: 160 }}>
              <Select label="Group" value={groupOf(it)} options={groups.map((g) => ({ value: g, label: g }))} onChange={(g) => update((p) => { p.budget = moveToGroup(p.budget, itemIndex(it.id), g); })} />
            </View>
          </View>
          <View style={styles.editRow}>
            <Button title="Up" icon="up" tone="ghost" disabled={idx <= 0 || groupOf(state.budget[idx - 1]!) !== groupOf(it)} onPress={() => update((p) => { p.budget = moveItem(p.budget, itemIndex(it.id), -1); })} style={{ minHeight: 36 }} />
            <Button title="Down" icon="down" tone="ghost" disabled={idx >= state.budget.length - 1 || groupOf(state.budget[idx + 1]!) !== groupOf(it)} onPress={() => update((p) => { p.budget = moveItem(p.budget, itemIndex(it.id), 1); })} style={{ minHeight: 36 }} />
            <Button
              title="Delete"
              icon="trash"
              tone="danger"
              onPress={async () => {
                if (await confirm(`Delete "${it.name || "this category"}"?`, "It comes off your budget and your plan.", "Delete")) {
                  setOpen(null);
                  update((p) => { p.budget = p.budget.filter((x) => x.id !== it.id); });
                }
              }}
              style={{ minHeight: 36 }}
            />
          </View>
        </View>
      );
    }
    if (c.kind === "saving")
      return (
        <View style={[styles.catBox, { borderTopColor: t.border }]}>
          <Text style={[type.overline, { color: t.text3 }]}>Plan for this account</Text>
          <MonthlyAmount k={c.key} label={label(c)} note={c.moves ? undefined : "Cash can go past your emergency fund goal if you plan it."} />
          <Text style={[type.caption, { color: t.text3 }]}>Sets what "Fill from plan" assigns here each month, and what the forecast expects after this month.</Text>
        </View>
      );
    const isBill = c.kind === "bill";
    return (
      <Pressable role="link" onPress={() => router.push(isBill ? "/money/goals" : "/money/debts")} hitSlop={6} style={styles.link}>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{isBill ? "Change this bill (Savings goals)" : "Change this debt (Debts)"}</Text>
        <Icon name="chevron" size={12} color={t.accent} />
      </Pressable>
    );
  };

  const line = (c: BudgetCategory) => {
    const l = view.lines[c.key]!;
    const isOpen = open === c.key;
    const explicitSpent = entry?.spent?.[c.key] !== undefined;
    return (
      <View key={c.key}>
        <Pressable role="button" aria-expanded={isOpen} accessibilityLabel={`${label(c)}: ${money(l.available)} available`} onPress={() => { setOpen(isOpen ? null : c.key); setMoveAmt(0); setMoveTo(""); }} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: t.surface2 } : null]}>
          <Text style={[type.body, { color: t.text, flex: 1, minWidth: 0 }]} numberOfLines={1}>{label(c)}</Text>
          {num(l.assigned, t.text2)}
          {num(l.spent, t.text2)}
          <View style={{ width: COLW, alignItems: "flex-end" }}>{pill(l, c)}</View>
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
            {c.moves ? (
              // money that leaves by itself (a debt payment, a transfer to an investment): counts as paid when assigned
              <View style={styles.editRow}>
                <Text style={[type.caption, { color: t.text2, width: 70 }]}>Paid</Text>
                <NumberInput kind="money" label={`${label(c)} paid in ${nameOf(month)}`} value={l.spent} width={140} step={25} onChange={(v) => setSpent(c.key, v)} />
                {explicitSpent ? <Button title="Same as assigned" tone="ghost" onPress={() => setSpent(c.key, undefined)} style={{ minHeight: 36 }} /> : null}
              </View>
            ) : (
              <View style={styles.editRow}>
                <Text style={[type.caption, { color: t.text2, width: 70 }]}>Spent</Text>
                <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(l.spent)}</Text>
                <Text style={[type.caption, { color: t.text3, flex: 1, minWidth: 140 }]}>From this month&apos;s transactions{explicitSpent ? " (plus an amount entered before transactions)" : ""}.</Text>
                {explicitSpent ? <Button title="Remove that amount" tone="ghost" onPress={() => setSpent(c.key, undefined)} style={{ minHeight: 36 }} /> : null}
              </View>
            )}
            {l.available < -0.005 ? (
              <Button title={`Cover ${money(-l.available)} from ready to assign`} tone="primary" onPress={() => setAssigned(c.key, l.assigned - l.available)} style={{ minHeight: 36, alignSelf: "flex-start" }} />
            ) : null}
            {l.assigned > 0.005 ? (
              <View style={styles.editRow}>
                <Text style={[type.caption, { color: t.text2, width: 70 }]}>Move</Text>
                <NumberInput kind="money" label={`Amount to move from ${label(c)}`} value={moveAmt} width={120} step={25} onChange={setMoveAmt} />
                <View style={{ minWidth: 150, flex: 1 }}>
                  <Select
                    label="Move to"
                    value={moveTo}
                    options={[{ value: "", label: "Pick a category" }, ...cats.filter((x) => x.key !== c.key).map((x) => ({ value: x.key, label: label(x), hint: x.group }))]}
                    onChange={setMoveTo}
                  />
                </View>
                <Button
                  title="Move"
                  disabled={!moveTo}
                  onPress={() => {
                    // nothing typed: move what's available
                    const amt = Math.min(moveAmt > 0 ? moveAmt : Math.max(0, l.available), l.assigned);
                    moveMoney(c.key, moveTo, amt);
                    setMoveTo("");
                    setMoveAmt(0);
                  }}
                  style={{ minHeight: 36 }}
                />
              </View>
            ) : null}
            {(() => {
              const list = monthTxns.filter((x) => x.categoryId === c.key || x.splits?.some((y) => y.categoryId === c.key) || (c.kind === "debt" && x.accountId === c.key.slice(5) && !!x.transferAccountId));
              return (
                <View style={{ gap: 4 }}>
                  {list.slice(0, 8).map((x) => (
                    <Pressable key={x.id} role="button" onPress={() => setAdding({ txn: x })} style={styles.acctRow}>
                      <Text style={[type.caption, { color: t.text2, flex: 1 }]} numberOfLines={1}>{x.date.slice(5).replace("-", "/")} · {x.payee || "Transaction"}</Text>
                      <Text style={[type.caption, { color: x.amount > 0 ? t.good : t.text, fontVariant: ["tabular-nums"] }]}>{x.amount > 0 ? "+" : "−"}{money(Math.abs(x.amount))}</Text>
                    </Pressable>
                  ))}
                  {list.length > 8 ? <Text style={[type.caption, { color: t.text3 }]}>and {list.length - 8} more</Text> : null}
                  <Button title="Add a transaction here" icon="plus" tone="ghost" onPress={() => setAdding({ categoryId: c.key })} style={{ minHeight: 34, alignSelf: "flex-start" }} />
                </View>
              );
            })()}
            {categoryEditor(c)}
            <Text style={[type.caption, { color: t.text3 }]}>
              {l.carried > 0.5 ? `${money(l.carried)} carried over from last month. ` : ""}
              {c.kind === "saving" && c.moves
                ? "Counts as moved to the account when assigned (change Paid if you moved a different amount). Your plan uses what you assign here."
                : c.kind === "saving"
                  ? "Stays here and builds up. Your plan uses what you assign here."
                  : c.kind === "debt" && cards[c.key.slice(5)] !== undefined
                    ? `Spending on this card moves money here from its categories${(l.funded ?? 0) > 0.5 ? ` (${money(l.funded ?? 0)} this month)` : ""}, so the payment is covered. Assign more to pay down what you already owe. A payment (a transfer from checking) spends it.`
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
          <Card style={{ gap: space.sm }}>
            <View style={[styles.editRow, { justifyContent: "space-between" }]}>
              <SectionLabel>Accounts</SectionLabel>
              <Button title="Add a transaction" icon="plus" tone="primary" onPress={() => setAdding({})} style={{ minHeight: 36 }} />
            </View>
            {accts.map((a) => (
              <Pressable key={a.id} role="link" accessibilityLabel={`${a.name} register`} onPress={() => router.push(`/money/register?account=${a.id}`)} style={styles.acctRow}>
                <Text style={[type.body, { color: t.text, flex: 1 }]} numberOfLines={1}>{a.name}</Text>
                <Text style={[type.body, { color: a.balance < 0 ? t.text2 : t.text, fontVariant: ["tabular-nums"] }]}>{a.kind === "card" ? `${money(-a.balance)} owed` : money(a.balance)}</Text>
                <Icon name="chevron" size={14} color={t.text3} />
              </Pressable>
            ))}
            {!accts.length ? <Text style={[type.caption, { color: t.text3 }]}>Add a cash account or credit card under Money to track transactions.</Text> : null}
            <Text style={[type.caption, { color: t.text3 }]}>Tap an account for its transactions. A credit card missing here? Set its type to Credit card under Money → Debts.</Text>
          </Card>
          <View style={[styles.colHead, { paddingHorizontal: space.lg }]}>
            <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Category</Text>
            {["Assigned", "Spent", "Available"].map((h) => (
              <Text key={h} style={[type.overline, { color: t.text3, width: COLW, textAlign: "right" }]}>{h}</Text>
            ))}
          </View>
          {groups.map((g) => {
            const avail = g.cats.reduce((a, c) => a + view.lines[c.key]!.available, 0);
            const assigned = g.cats.reduce((a, c) => a + view.lines[c.key]!.assigned, 0);
            const spent = g.cats.reduce((a, c) => a + view.lines[c.key]!.spent, 0);
            return (
              <Card key={g.name} padded={false}>
                <Pressable
                  role="button"
                  disabled={g.kind !== "spending"}
                  aria-expanded={groupOpen === g.name}
                  accessibilityLabel={`${g.name} group${g.kind === "spending" ? ": rename, reorder or add a category" : ""}`}
                  onPress={() => { setGroupOpen(groupOpen === g.name ? null : g.name); setGroupDraft(g.name); }}
                  style={[styles.groupHead, { borderBottomColor: t.border }]}
                >
                  <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[type.overline, { color: t.text2, flexShrink: 1 }]} numberOfLines={1}>{g.name}</Text>
                    {g.kind === "spending" ? <Icon name="edit" size={12} color={t.text3} /> : null}
                  </View>
                  {num(assigned, t.text3, true)}
                  {num(spent, t.text3, true)}
                  {num(avail, avail < -0.5 ? t.bad : t.text2, true)}
                </Pressable>
                {groupOpen === g.name && g.kind === "spending" ? (
                  <View style={[styles.editor, { backgroundColor: t.surface2, marginTop: space.md }]}>
                    <View style={styles.editRow}>
                      <View style={{ flex: 1, minWidth: 160 }}>
                        <TextField label="Group name" value={groupDraft} onChange={setGroupDraft} />
                      </View>
                      <Button title="Rename" disabled={!groupDraft.trim() || groupDraft.trim() === g.name} onPress={() => { renameGroup(g.name, groupDraft); setGroupOpen(groupDraft.trim()); }} style={{ minHeight: 36 }} />
                    </View>
                    <View style={styles.editRow}>
                      <Button title="Add a category" icon="plus" onPress={() => addItem(g.name)} style={{ minHeight: 36 }} />
                      <Button title="Earlier" icon="up" tone="ghost" disabled={groupOrder(state.budget)[0] === g.name} onPress={() => update((p) => { p.budget = moveGroup(p.budget, g.name, -1); })} style={{ minHeight: 36 }} />
                      <Button title="Later" icon="down" tone="ghost" disabled={groupOrder(state.budget).at(-1) === g.name} onPress={() => update((p) => { p.budget = moveGroup(p.budget, g.name, 1); })} style={{ minHeight: 36 }} />
                    </View>
                  </View>
                ) : null}
                {g.cats.map((c, n) => (
                  <View key={c.key}>
                    {n > 0 ? <Divider /> : null}
                    {line(c)}
                  </View>
                ))}
              </Card>
            );
          })}
          <Pressable role="link" onPress={() => router.push("/settings")} hitSlop={6} style={styles.link}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Manage income, accounts, debts and goals</Text>
            <Icon name="chevron" size={12} color={t.accent} />
          </Pressable>
          <View style={styles.editRow}>
            <Button title="Add a group" icon="plus" onPress={addGroup} style={{ minHeight: 36 }} />
            <Button title={`Add to ${groupOrder(state.budget)[0] ?? UNGROUPED}`} icon="plus" tone="ghost" onPress={() => addItem(groupOrder(state.budget)[0] ?? UNGROUPED)} style={{ minHeight: 36 }} />
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>
            Still paid after you retire: {money(state.budget.filter((x) => x.inRetirement).reduce((a, x) => a + x.amount, 0))}/mo of spending (plus healthcare). That sets your retirement number. Bills come from repeating savings goals and debt payments from Debts; tap one to change it there. Transactions and bank import come next; for now, enter what you spent per category.
          </Text>
          <Button
            title="Start the budget over"
            tone="ghost"
            icon="trash"
            onPress={async () => {
              if (await confirm("Start the budget over?", "Everything you assigned, spent and received in the budget is cleared, and so are its transactions. Account balances stay as they are now. Your plan, accounts and budget items stay.", "Start over")) {
                update((p) => { delete p.budgetPlan; });
                clearTxns();
              }
            }}
            style={{ alignSelf: "flex-start", minHeight: 36 }}
          />
        </>
      ) : (
        <Card>
          <Text style={[type.body, { color: t.text2 }]}>Your budget starts in {nameOf(b.start)}.</Text>
        </Card>
      )}
      {adding ? <TxnForm txn={adding.txn} categoryId={adding.categoryId} initialKind={adding.kind} initialAmount={adding.amount} onClose={() => setAdding(null)} /> : null}
      {month === thisMonth && i === 0 ? <View style={{ height: 1 }} /> : <Pill tone="neutral">{i > 0 ? "A future month: assign ahead if you like" : "A past month"}</Pill>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", gap: space.md },
  navBtn: { borderWidth: 1, borderRadius: 999, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  groupHead: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignItems: "flex-end" },
  colHead: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: -space.sm },
  editor: { gap: space.sm, marginHorizontal: space.md, marginBottom: space.md, padding: space.md, borderRadius: radius.md },
  editRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  acctRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6 },
  catBox: { gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, marginTop: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
});
