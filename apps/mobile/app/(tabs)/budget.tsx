/**
 * Budget: every dollar gets a job. Money that comes in is ready to assign; you assign it to your
 * categories (budget items, bills, debt payments, savings), what you don't spend carries into next
 * month, and what you assign to savings and debts is what the plan counts as done that month.
 */
import { BUDGET_ITEM, budgetCategories, budgetView, SAVINGS_GROUP, type BudgetCategory, type BudgetLine, type Txn } from "@coastfi/engine";
import { TxnForm } from "../../components/TxnForm";
import { BudgetAccounts } from "../../components/BudgetAccounts";
import { TransactionsList } from "../../components/TransactionsList";
import { cardMap, liveBudget } from "../../lib/register";
import { linkableAccounts, suggestedAccount } from "../../lib/budgetDupes";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Chip, FormList, FormRow, InlineMoney, InlineSwitch, InlineText, NumberInput, Segmented, Select } from "../../components/form";
import { ChangesLater, MonthlyAmount } from "../../components/ScheduleEditor";
import { groupOf, groupOrder, moveGroup, moveToGroup, UNGROUPED } from "../../lib/budgetOrder";
import { DragList, reorderAmong } from "../../components/DragList";
import { newId } from "../../lib/store";
import { useLocalSearchParams, useRouter } from "expo-router";
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
// the built-in groups first (debt payments, savings, bills), then the groups you made
const ORDER: Record<BudgetCategory["kind"], number> = { debt: 0, saving: 1, bill: 2, spending: 3 };

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
  const [moveOpen, setMoveOpen] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const router = useRouter();
  // opened from a link (a plan step, a to-do): show this month with that line open
  const { focus, view: viewParam, account: acctParam } = useLocalSearchParams<{ focus?: string; view?: string; account?: string }>();
  // Categories (assign money), Accounts (what's in each), or Transactions (what came in and went out)
  type View3 = "categories" | "accounts" | "transactions";
  const [tab, setTab] = useState<View3>(viewParam === "transactions" || viewParam === "accounts" ? viewParam : "categories");
  useEffect(() => {
    if (viewParam === "transactions" || viewParam === "accounts") setTab(viewParam);
  }, [viewParam, acctParam]);
  useEffect(() => {
    if (!focus) return;
    setTab("categories");
    setMonth(thisMonth);
    setOpen(focus);
    if (Platform.OS === "web" && typeof document !== "undefined")
      setTimeout(() => document.getElementById("cat-" + focus)?.scrollIntoView({ behavior: "smooth", block: "center" }), 350);
    router.setParams({ focus: undefined });
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = liveBudget(state);
  const cats = useMemo(() => budgetCategories(state, result.d, actual, start, month), [state, result, actual, start, month]);
  const txns = useStore((s) => s.txns);
  const cards = useMemo(() => cardMap(state), [state]);
  const view = budgetView(b, cats, month, { txns, cards });
  const [adding, setAdding] = useState<{ txn?: Txn; categoryId?: string; kind?: "out" | "in"; amount?: number; from?: string } | null>(null);
  const monthTxns = txns.filter((x) => !x.deleted && x.date.startsWith(month));
  const i = between(thisMonth, month);
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
  const itemIndex = (id: string) => state.budget.findIndex((x) => x.id === id);
  const editItem = (id: string, patch: Partial<(typeof state.budget)[number]>) =>
    update((p) => {
      const i = p.budget.findIndex((x) => x.id === id);
      if (i >= 0) p.budget[i] = { ...p.budget[i]!, ...patch };
    });
  const addItem = (group: string) => {
    const id = newId();
    // a category added next to your savings is saving up, not spending you keep after you retire
    const saving = cats.some((c) => c.group === group && c.kind === "saving");
    update((p) => {
      const last = p.budget.map((x, i) => (groupOf(x) === group ? i : -1)).filter((i) => i >= 0).at(-1) ?? p.budget.length - 1;
      p.budget.splice(last + 1, 0, { id, name: "", amount: 0, inRetirement: !saving, group, ...(saving ? { essential: false } : {}) });
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
      // everything shown in the group moves with it, including what sits there by default
      p.debts.forEach((x) => { if ((x.budgetGroup?.trim() || "Debt payments") === from) x.budgetGroup = name; });
      p.goals.forEach((x) => { if ((x.budgetGroup?.trim() || (x.recurring ? "Bills" : "Savings goals")) === from) x.budgetGroup = name; });
      if (p.budgetPlan && (p.budgetPlan.efLine?.group?.trim() || SAVINGS_GROUP) === from) p.budgetPlan.efLine = { ...p.budgetPlan.efLine, group: name };
    });
  /** The Emergency fund category's name or group. */
  const editEf = (patch: { name?: string; group?: string }) =>
    update((p) => {
      if (p.budgetPlan) p.budgetPlan.efLine = { ...p.budgetPlan.efLine, ...patch };
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
  /** Link a category to an account (money moved there: investing, not spending), or unlink it. */
  const linkItem = (itemId: string, accountId: string) =>
    update((p) => {
      const it = p.budget.find((x) => x.id === itemId);
      if (!it) return;
      if (accountId) it.accountId = accountId;
      else delete it.accountId;
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
  const groupNames = [...new Set([...groups.map((g) => g.name), ...groupOrder(state.budget)])];
  /** A group of only your own categories can be dragged and moved; one with savings, bills or debts keeps its place. */
  const ownGroup = (g: (typeof groups)[number]) => g.cats.every((c) => c.kind === "spending");
  const rta = view.readyToAssign;
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
      </View>
      {(entry?.income ?? 0) > 0.005 ? (
        <Text style={[type.caption, { color: t.text3 }]}>
          Includes {money(entry!.income!)} of income typed in before you had transactions.{" "}
          <Text role="button" onPress={() => setIncome(undefined)} style={{ color: t.accent, fontWeight: "700" }}>Remove it</Text>
        </Text>
      ) : null}
    </Card>
  );

  const COLW = compact ? 88 : 108;
  /** PILL_IN: the Available pill's inner padding, so header and group totals line up with its text. */
  const PILL_IN = 8;
  const num = (v: number, color: string, bold = false, inset = 0) => (
    <Text style={[type.caption, { width: COLW, paddingRight: inset, textAlign: "right", color, fontWeight: bold ? "700" : "500", fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
      {money(v)}
    </Text>
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

  /** Change the category itself: name, plan amount, group, order (spending); target (savings); links (bills, debts). */
  const categoryEditor = (c: BudgetCategory) => {
    if (c.kind === "spending") {
      const it = state.budget.find((x) => x.id === c.key);
      if (!it) return null;
      const linkable = linkableAccounts(state);
      const linkedTo = linkable.find((a) => a.id === it.accountId);
      return (
        <View style={styles.section}>
          <Text style={[type.overline, { color: t.text3 }]}>Category</Text>
          <FormList>
            <FormRow label="Name">
              <InlineText label="Category name" placeholder="e.g. Groceries" value={it.name} onChange={(v) => editItem(it.id, { name: v })} />
            </FormRow>
            <FormRow label="Money moved to" hint={linkedTo ? "Investing, not spending: your plan counts it as your contribution" : "Pick an account if this is money you invest"}>
              <Select
                plain
                label="Money moved to"
                value={linkedTo?.id ?? ""}
                options={[{ value: "", label: "Nothing (spending)" }, ...linkable.map((a) => ({ value: a.id, label: a.name.trim() || "Account" }))]}
                onChange={(v) => linkItem(it.id, v)}
              />
            </FormRow>
            <FormRow label="Each month" hint={linkedTo ? `What you put into ${linkedTo.name.trim() || "the account"} each month` : "What your plan expects"}>
              <InlineMoney label={`${it.name || "Item"} planned each month`} value={it.amount} onChange={(v) => editItem(it.id, { amount: v })} />
            </FormRow>
            {linkedTo ? null : (
              <>
                <FormRow label="Still paid after you retire" hint="Counts toward your retirement number">
                  <InlineSwitch label="Still paid after you retire" value={it.inRetirement} onChange={(v) => editItem(it.id, { inRetirement: v })} />
                </FormRow>
                <FormRow label="Essential" hint="Kept in emergency mode">
                  <InlineSwitch label="Essential" value={it.essential !== false} onChange={(v) => editItem(it.id, { essential: v })} />
                </FormRow>
              </>
            )}
            <FormRow label="Group">
              <Select plain label="Group" value={groupOf(it)} options={groupNames.map((g) => ({ value: g, label: g }))} onChange={(g) => update((p) => { p.budget = moveToGroup(p.budget, itemIndex(it.id), g); })} />
            </FormRow>
          </FormList>
          <ChangesLater
            k={BUDGET_ITEM + it.id}
            label={it.name || "This category"}
            base={it.amount}
            prompt="Going up, down or ending later?"
            note="Each month's budget and the forecast use the amount for that month."
          />
          <View style={[styles.chips, { justifyContent: "space-between" }]}>
            <Text style={[type.caption, { color: t.text3, flex: 1 }]}>Drag a category's grip to reorder it.</Text>
            <Chip
              title="Delete"
              icon="trash"
              tone="danger"
              onPress={async () => {
                if (await confirm(`Delete "${it.name || "this category"}"?`, "It comes off your budget and your plan.", "Delete")) {
                  setOpen(null);
                  update((p) => { p.budget = p.budget.filter((x) => x.id !== it.id); });
                }
              }}
            />
          </View>
        </View>
      );
    }
    if (c.kind === "saving")
      return (
        <View style={styles.section}>
          {c.key === "cash" ? (
            <>
              <Text style={[type.overline, { color: t.text3 }]}>Category</Text>
              <FormList>
                <FormRow label="Name" hint="Your plan still treats it as your emergency fund">
                  <InlineText label="Category name" placeholder="Emergency fund" value={b.efLine?.name ?? ""} commitOnBlur onChange={(v) => editEf({ name: v.trim() || undefined })} />
                </FormRow>
                <FormRow label="Group">
                  <Select plain label="Group" value={c.group} options={groupNames.map((g) => ({ value: g, label: g }))} onChange={(g) => editEf({ group: g })} />
                </FormRow>
              </FormList>
            </>
          ) : null}
          <Text style={[type.overline, { color: t.text3 }]}>Plan for this account</Text>
          <MonthlyAmount k={c.key} label={label(c)} note={c.moves ? undefined : "Cash can go past your emergency fund goal if you plan it."} />
          <Text style={[type.caption, { color: t.text3 }]}>The plan amount for this category each month (its "Use plan" button), and what the forecast expects after this month.</Text>
          {c.key.startsWith("acct:") && c.moves ? (
            <View style={styles.chips}>
              <Chip
                title="I don't add to this account"
                icon="close"
                onPress={async () => {
                  if (!(await confirm(`Hide ${c.name}?`, "Its line leaves the budget and the plan stops adding to it. It still counts in your net worth and investments. To undo, set its Counts as under Money → Accounts.", "Hide"))) return;
                  setOpen(null);
                  update((p) => {
                    const a = p.accounts.find((x) => "acct:" + x.id === c.key);
                    if (a) a.counts = "other";
                  });
                }}
              />
            </View>
          ) : null}
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

  const line = (c: BudgetCategory, grip?: ReactNode) => {
    const l = view.lines[c.key]!;
    const isOpen = open === c.key;
    const explicitSpent = entry?.spent?.[c.key] !== undefined;
    const dupItem = c.kind === "spending" && !c.account ? state.budget.find((x) => x.id === c.key) : undefined;
    const dup = dupItem && !dupItem.noSuggest ? suggestedAccount(state, c.name) : undefined;
    return (
      <View key={c.key} nativeID={"cat-" + c.key}>
        <Pressable role="button" aria-expanded={isOpen} accessibilityLabel={`${label(c)}: ${money(l.available)} available`} onPress={() => { setOpen(isOpen ? null : c.key); setMoveAmt(0); setMoveTo(""); setMoveOpen(false); }} style={({ pressed }) => [styles.row, compact ? { paddingHorizontal: space.md } : null, pressed ? { backgroundColor: t.surface2 } : null]}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
            {grip}
            <Text style={[type.body, { color: t.text, flexShrink: 1 }]} numberOfLines={2}>{label(c)}</Text>
            {dup ? <Icon name="info" size={14} color={t.warn} /> : null}
          </View>
          {num(l.assigned, t.text2)}
          {compact ? null : num(l.spent, t.text2)}
          <View style={{ width: COLW, alignItems: "flex-end" }}>{pill(l, c)}</View>
        </Pressable>
        {isOpen ? (
          <View style={[styles.editor, { backgroundColor: t.surface2 }]}>
            {dup ? (
              <View style={[styles.dupBox, { backgroundColor: t.warnSoft, borderColor: t.warn }]}>
                <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Money moved to {dup.name}?</Text>
                <Text style={[type.caption, { color: t.text2 }]}>
                  Right now this counts as spending, so it raises your retirement number and your plan counts the money twice. Link it to the account and it counts as investing instead.
                </Text>
                <View style={styles.chips}>
                  <Chip title={`Link to ${dup.name}`} tone="accent" icon="check" onPress={() => linkItem(c.key, dup.id)} />
                  <Chip title="It's spending" icon="close" onPress={() => editItem(c.key, { noSuggest: true })} />
                </View>
              </View>
            ) : null}
            <View style={styles.section}>
              <Text style={[type.overline, { color: t.text3 }]}>{nameOf(month)}</Text>
              <FormList>
                <FormRow label="Assigned" hint={c.target > 0.5 ? `Plan: ${money(c.target)}` : undefined}>
                  <InlineMoney label={`${label(c)} assigned in ${nameOf(month)}`} value={l.assigned} onChange={(v) => setAssigned(c.key, v)} />
                </FormRow>
                <FormRow label={c.moves ? "Paid" : "Spent"} hint={explicitSpent ? "Includes an amount from before transactions" : c.moves ? "From the payment or transfer you record" : "From transactions"}>
                  <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(l.spent)}</Text>
                </FormRow>
                <FormRow label="Available" hint={l.carried > 0.5 ? `${money(l.carried)} carried over` : (l.funded ?? 0) > 0.5 ? `+${money(l.funded ?? 0)} from card spending` : undefined}>
                  <Text style={[type.body, { color: l.available < -0.005 ? t.bad : l.available > 0.5 ? t.good : t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(l.available)}</Text>
                </FormRow>
              </FormList>
              <View style={styles.chips}>
                {c.target > 0.5 && Math.abs(l.assigned - c.target) > 0.5 ? <Chip title={`Use plan ${money(c.target)}`} tone="accent" onPress={() => setAssigned(c.key, Math.round(c.target * 100) / 100)} /> : null}
                {l.available < -0.005 ? <Chip title={`Cover ${money(-l.available)}`} tone="accent" icon="check" onPress={() => setAssigned(c.key, l.assigned - l.available)} /> : null}
                <Chip title="Transaction" icon="plus" onPress={() => setAdding({ categoryId: c.key })} />
                {l.assigned > 0.005 ? <Chip title={moveOpen ? "Cancel move" : "Move money"} onPress={() => setMoveOpen((v) => !v)} /> : null}
                {explicitSpent ? <Chip title="Remove old amount" onPress={() => setSpent(c.key, undefined)} /> : null}
              </View>
            </View>
            {moveOpen && l.assigned > 0.005 ? (
              <View style={styles.section}>
                <FormList>
                  <FormRow label="Amount" hint={`Up to ${money(l.assigned)}`}>
                    <InlineMoney label={`Amount to move from ${label(c)}`} value={moveAmt || Math.max(0, Math.min(l.available, l.assigned))} onChange={setMoveAmt} />
                  </FormRow>
                  <FormRow label="To">
                    <Select plain label="Move to" placeholder="Choose" value={moveTo} options={[{ value: "", label: "Choose" }, ...cats.filter((x) => x.key !== c.key).map((x) => ({ value: x.key, label: label(x), hint: x.group }))]} onChange={setMoveTo} />
                  </FormRow>
                </FormList>
                <Button
                  title="Move"
                  tone="primary"
                  disabled={!moveTo}
                  onPress={() => {
                    // nothing typed: move what's available
                    const amt = Math.min(moveAmt > 0 ? moveAmt : Math.max(0, l.available), l.assigned);
                    moveMoney(c.key, moveTo, amt);
                    setMoveTo("");
                    setMoveAmt(0);
                    setMoveOpen(false);
                  }}
                  style={{ minHeight: 40 }}
                />
              </View>
            ) : null}
            {(() => {
              const list = monthTxns.filter((x) => x.categoryId === c.key || x.splits?.some((y) => y.categoryId === c.key) || (c.kind === "debt" && x.accountId === c.key.slice(5) && !!x.transferAccountId));
              if (!list.length) return null;
              return (
                <View style={styles.section}>
                  <Text style={[type.overline, { color: t.text3 }]}>Transactions</Text>
                  <FormList>
                    {list.slice(0, 8).map((x) => (
                      <Pressable key={x.id} role="button" onPress={() => setAdding({ txn: x })} style={styles.txnRow}>
                        <Text style={[type.body, { color: t.text, flex: 1 }]} numberOfLines={1}>{x.payee || "Transaction"}</Text>
                        <Text style={[type.caption, { color: t.text3 }]}>{x.date.slice(5).replace("-", "/")}</Text>
                        <Text style={[type.body, { color: x.amount > 0 ? t.good : t.text, fontVariant: ["tabular-nums"], minWidth: 72, textAlign: "right" }]}>{x.amount > 0 ? "+" : "−"}{money(Math.abs(x.amount))}</Text>
                      </Pressable>
                    ))}
                  </FormList>
                  {list.length > 8 ? <Text style={[type.caption, { color: t.text3 }]}>and {list.length - 8} more in the account registers</Text> : null}
                </View>
              );
            })()}
            {categoryEditor(c)}
            <Text style={[type.caption, { color: t.text3 }]}>
              {l.carried > 0.5 ? `${money(l.carried)} carried over from last month. ` : ""}
              {c.kind === "saving" && c.moves
                ? "Stays available until you record the transfer to the account (Transaction → Transfer). Your plan uses what you assign here."
                : c.kind === "saving"
                  ? "Stays here and builds up. Your plan uses what you assign here."
                  : c.kind === "debt" && cards[c.key.slice(5)] !== undefined
                    ? `Spending on this card moves money here from its categories${(l.funded ?? 0) > 0.5 ? ` (${money(l.funded ?? 0)} this month)` : ""}, so the payment is covered. Assign more to pay down what you already owe. A payment (a transfer from checking) spends it.`
                    : c.kind === "debt"
                    ? "Minimum plus any extra. Stays available until you record the payment (a transaction with this category). What you assign beyond the minimum is your extra payment in the plan."
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
        <View style={[styles.editRow, { justifyContent: "space-between" }]}>
          <View style={{ flexGrow: 1, flexShrink: 1, maxWidth: 440 }}>
            <Segmented
              label="Budget view"
              options={[{ value: "categories", label: "Categories" }, { value: "accounts", label: "Accounts" }, { value: "transactions", label: compact ? "Activity" : "Transactions" }]}
              value={tab}
              onChange={(v) => { setTab(v); if (v !== "transactions" && (acctParam || viewParam)) router.setParams({ account: undefined, view: undefined }); }}
            />
          </View>
          {tab === "categories" ? <Button title={compact ? "Add" : "Add a transaction"} icon="plus" tone="primary" onPress={() => setAdding({})} style={{ minHeight: 36 }} /> : null}
        </View>
      ) : null}
      {view.started && tab === "transactions" ? (
        <TransactionsList key={acctParam ?? "all"} month={month} account={acctParam} />
      ) : view.started && tab === "accounts" ? (
        <BudgetAccounts onAdd={() => setAdding({})} onTransfer={(from) => setAdding({ from })} />
      ) : view.started ? (
        <>
          {rtaCard}
          <View style={[styles.colHead, { paddingHorizontal: compact ? space.md : space.lg }]}>
            <Text style={[type.caption, styles.colName, { color: t.text3, flex: 1 }]}>Category</Text>
            {(compact ? ["Assigned", "Available"] : ["Assigned", "Spent", "Available"]).map((h) => (
              <Text key={h} numberOfLines={1} style={[type.caption, styles.colName, { color: t.text3, width: COLW, textAlign: "right", paddingRight: h === "Available" ? PILL_IN : 0 }]}>{h}</Text>
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
                  aria-expanded={groupOpen === g.name}
                  accessibilityLabel={`${g.name} group: rename${ownGroup(g) ? ", reorder" : ""} or add a category`}
                  onPress={() => { setGroupOpen(groupOpen === g.name ? null : g.name); setGroupDraft(g.name); }}
                  style={[styles.groupHead, { borderBottomColor: t.border }, compact ? { paddingHorizontal: space.md } : null]}
                >
                  <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[type.overline, { color: t.text2, flexShrink: 1 }]} numberOfLines={2}>{g.name}</Text>
                    <Icon name="edit" size={12} color={t.text3} />
                  </View>
                  {num(assigned, t.text3, true)}
                  {compact ? null : num(spent, t.text3, true)}
                  {num(avail, avail < -0.5 ? t.bad : t.text2, true, PILL_IN)}
                </Pressable>
                {groupOpen === g.name ? (
                  <View style={[styles.editor, { backgroundColor: t.surface2, marginTop: space.md }]}>
                    <FormList>
                      <FormRow label="Group name">
                        <InlineText label="Group name" value={g.name} commitOnBlur onChange={(v) => { renameGroup(g.name, v); setGroupOpen(v.trim()); }} />
                      </FormRow>
                    </FormList>
                    <View style={styles.chips}>
                      <Chip title="Add category" icon="plus" tone="accent" onPress={() => addItem(g.name)} />
                      {ownGroup(g) ? (
                        <>
                          <Chip title="Earlier" icon="up" disabled={groupOrder(state.budget)[0] === g.name} onPress={() => update((p) => { p.budget = moveGroup(p.budget, g.name, -1); })} />
                          <Chip title="Later" icon="down" disabled={groupOrder(state.budget).at(-1) === g.name} onPress={() => update((p) => { p.budget = moveGroup(p.budget, g.name, 1); })} />
                        </>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                {ownGroup(g) && g.cats.length > 1 ? (
                  <DragList
                    count={g.cats.length}
                    keyOf={(n) => g.cats[n]!.key}
                    nameOf={(n) => g.cats[n]!.name}
                    onMove={(from, to) => update((p) => { p.budget = reorderAmong(p.budget, (b) => groupOf(b) === g.name, from, to); })}
                    renderItem={(n, grip) => (
                      <View>
                        {n > 0 ? <Divider /> : null}
                        {line(g.cats[n]!, grip)}
                      </View>
                    )}
                  />
                ) : (
                  g.cats.map((c, n) => (
                    <View key={c.key}>
                      {n > 0 ? <Divider /> : null}
                      {line(c)}
                    </View>
                  ))
                )}
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
            Still paid after you retire: {money(state.budget.filter((x) => x.inRetirement && !x.accountId).reduce((a, x) => a + x.amount, 0))}/mo of spending (plus healthcare). That sets your retirement number. Bills come from repeating savings goals and debt payments from Debts; tap one to change it there. Spent and paid come from the transactions you record.
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
      {adding ? <TxnForm txn={adding.txn} categoryId={adding.categoryId} initialKind={adding.kind} initialAmount={adding.amount} transferFrom={adding.from} onClose={() => setAdding(null)} /> : null}
      {month === thisMonth && i === 0 ? <View style={{ height: 1 }} /> : <Pill tone="neutral">{i > 0 ? "A future month: assign ahead if you like" : "A past month"}</Pill>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", gap: space.md },
  navBtn: { borderWidth: 1, borderRadius: 999, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  groupHead: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignItems: "flex-end", maxWidth: "100%" },
  colHead: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, marginBottom: -space.sm },
  colName: { fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3, fontSize: 11 },
  section: { gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  editor: { gap: space.md, marginHorizontal: space.md, marginBottom: space.md, padding: space.md, borderRadius: radius.md },
  editRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  dupBox: { gap: 6, borderWidth: 1, borderRadius: radius.md, padding: space.md },
  txnRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, minHeight: 46 },
  link: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
});
