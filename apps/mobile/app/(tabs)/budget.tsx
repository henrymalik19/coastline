/**
 * Budget: you decide where your money goes. Money that comes in is unassigned; you assign it to your
 * categories (budget items, bills, debt payments, savings), what you don't spend carries into next
 * month, and what you assign to savings and debts is what the plan counts as done that month.
 */
import { ReorderToggle } from "../../components/ReorderToggle";
import { fullName } from "../../lib/company";
import { debtItPays, newLoanPayment, paidLastTwoMonths, setLoanPayment } from "../../lib/debtLink";
import { ImportUndoReminder, useImported } from "../../components/ImportUndo";
import { txnsIn } from "../../lib/combine";
import { BUDGET_ITEM, budgetCategories, budgetView, SAVINGS_GROUP, spendingHistory, type BudgetCategory, type BudgetLine, type Txn } from "@coastfi/engine";
import { TxnForm } from "../../components/TxnForm";
import { BudgetAccounts } from "../../components/BudgetAccounts";
import { TransactionsList } from "../../components/TransactionsList";
import { cardMap, isCard, liveBudget } from "../../lib/register";
import { linkableAccounts, suggestedAccount } from "../../lib/budgetDupes";
import { isoDay, needsCategory, needsCategorySince } from "../../lib/categories";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Chip, FormList, FormRow, InlineMoney, InlineSwitch, InlineText, NumberInput, Segmented, Select } from "../../components/form";
import { ChangesLater, MonthlyAmount } from "../../components/ScheduleEditor";
import { BILLS_GROUP, CLOSED_ACCOUNTS_GROUP, DEBTS_GROUP, groupOf, groupOrder, linkedGroupChoices, moveGroup, moveToGroup, setHidden, UNGROUPED } from "../../lib/budgetOrder";
import { DragList, reorderAmong, useDragZone } from "../../components/DragList";
import { newId } from "../../lib/store";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "../../components/Icon";
import { Card, Divider, Pill, Screen, SectionLabel } from "../../components/ui";
import { useAppearance } from "../../lib/appearance";
import { confirm } from "../../lib/confirm";
import { debtKind, debtLabel } from "../../lib/debts";
import { money, monthLabel } from "../../lib/format";
import { useLayout } from "../../lib/layout";
import { usePlan } from "../../lib/plan";
import { monthKey, useStore } from "../../lib/store";
import { radius, space, type, useTheme } from "../../lib/theme";
import { sticky } from "../../lib/sticky";
import { useOpenPage } from "../../lib/nav";

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
  // phones: grips only while reordering
  const [reorder, setReorder] = useState(false);
  const grips = !compact || reorder;
  const { state, result, actual, start } = usePlan();
  const update = useStore((s) => s.update);
  const combineCategories = useStore((s) => s.combineCategories);
  // just combined one category into another: shown on that one, with Undo, for a few seconds
  const [combined, setCombined] = useState<{ into: string; name: string; undo: () => void } | null>(null);
  useEffect(() => {
    if (!combined) return;
    const id = setTimeout(() => setCombined(null), 10000);
    return () => clearTimeout(id);
  }, [combined]);
  // drag a category from one of your groups into another
  const dragGroups = useRef<{ name: string; cats: { key: string }[] }[]>([]);
  const zone = useDragZone((fromList, from, toList, to) => {
    const c = dragGroups.current.find((g) => g.name === fromList)?.cats[from];
    if (!c) return;
    update((p) => { p.budget = moveToGroup(p.budget, p.budget.findIndex((b) => b.id === c.key), toList, to); });
  });
  const clearTxns = useStore((s) => s.clearTxns);
  const thisMonth = monthKey(start);
  const [month, setMonth] = useState(thisMonth);
  const [open, setOpen] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState<string | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const imported = useImported();
  const [groupDraft, setGroupDraft] = useState("");
  const router = useRouter();
  const openPage = useOpenPage();
  // opened from a link (a plan step, a to-do): show this month with that line open
  const { focus, view: viewParam, account: acctParam, needs: needsParam, review: reviewParam } = useLocalSearchParams<{ focus?: string; view?: string; account?: string; needs?: string; review?: string }>();
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
  const txns = useStore((s) => s.txns);
  const b = liveBudget(state, txns);
  const cats = useMemo(() => budgetCategories(state, result.d, actual, start, month), [state, result, actual, start, month]);
  const cards = useMemo(() => cardMap(state), [state]);
  // upcoming transactions (dated after today) don't count until their day
  const view = budgetView(b, cats, month, { txns, cards, asOf: isoDay(start) });
  // what you really spent in recent full months, against what the plan uses
  const history = useMemo(() => spendingHistory(b, cats, thisMonth, { txns, cards }), [b, cats, thisMonth, txns, cards]);
  const [realOpen, setRealOpen] = useState(false);
  // the column header's height, so each group's header sticks just under it
  const [colH, setColH] = useState(28);
  // the bar's height (the views and Add), which everything else sticks under
  const [barH, setBarH] = useState(56);
  // the Unassigned card has scrolled up under the bar (web): then the bar shows Unassigned instead
  const rtaRef = useRef<unknown>(null);
  const [rtaHidden, setRtaHidden] = useState(false);
  useEffect(() => {
    const el = rtaRef.current as Element | null;
    if (Platform.OS !== "web" || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setRtaHidden(!!e && !e.isIntersecting && e.boundingClientRect.top < barH + 1), { rootMargin: `-${barH}px 0px 0px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [barH, tab, view.started]);
  // transactions that still need a category (this month and last; older ones are history)
  const needsCount = txns.filter((x) => needsCategory(x, needsCategorySince(start))).length;
  // held for review (not approved in YNAB yet): counted once accepted
  const reviewCount = txns.filter((x) => !x.deleted && x.review).length;
  const openList = (filter: "needs" | "review") => { setTab("transactions"); router.setParams({ view: "transactions", needs: filter === "needs" ? "1" : undefined, review: filter === "review" ? "1" : undefined }); };
  // a display choice (Settings → Appearance), on unless turned off
  const showReal = useAppearance((s) => s.realSpending);
  const setShowReal = useAppearance((s) => s.setRealSpending);
  const [adding, setAdding] = useState<{ txn?: Txn; categoryId?: string; kind?: "out" | "in"; amount?: number; from?: string } | null>(null);
  // the account picked on the Transactions list: a new transaction added from there starts in it
  const [listAcct, setListAcct] = useState("all");
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
  // a negative amount takes money back out of the category: never more than it had coming into the month
  const setAssigned = (k: string, v: number) => edit((e) => { e.assigned = { ...(e.assigned ?? {}), [k]: Math.max(-Math.max(0, view.lines[k]?.carried ?? 0), v) }; });
  /**
   * A category that went over on a credit card: leave that overspending on the card as debt (`on`), or
   * let it come out of next month's Unassigned (the default). Split across the cards it was spent on.
   */
  const setCardDebt = (k: string, l: BudgetLine, on: boolean) =>
    edit((e) => {
      const rest = (e.cardDebt ?? []).filter((d) => d.cat !== k);
      if (on) {
        const spent = Object.entries(l.onCards ?? {}).filter(([, v]) => v > 0.005);
        const total = spent.reduce((a, [, v]) => a + v, 0);
        const amount = Math.min(Math.max(0, -l.available), total);
        for (const [card, v] of spent) rest.push({ cat: k, card, amount: Math.round(((amount * v) / total) * 100) / 100 });
      }
      if (rest.length) e.cardDebt = rest;
      else delete e.cardDebt;
    });
  /** A card's name from its payment key (debt:<id>). */
  const cardName = (key: string) => { const d = state.debts.find((x) => "debt:" + x.id === key); return d ? fullName(d, "the card") : "the card"; };
  /** How much a category went over on cards this month (what it could leave on them as debt). */
  const overOnCards = (l: BudgetLine) => Math.min(Math.max(0, -l.available), Object.values(l.onCards ?? {}).reduce((a, v) => a + Math.max(0, v), 0));
  /** A card's payment line, this month: what you owe beyond what's set aside to pay it. */
  const cardShort = (c: BudgetCategory, l: BudgetLine) => {
    if (c.kind !== "debt" || cards[c.key.slice(5)] === undefined || month !== thisMonth) return 0;
    const owed = state.debts.find((x) => "debt:" + x.id === c.key)?.balance ?? 0;
    return Math.max(0, Math.round((owed - Math.max(0, l.available)) * 100) / 100);
  };
  const itemIndex = (id: string) => state.budget.findIndex((x) => x.id === id);
  const editItem = (id: string, patch: Partial<(typeof state.budget)[number]>) =>
    update((p) => {
      const i = p.budget.findIndex((x) => x.id === id);
      if (i >= 0) {
        const next = { ...p.budget[i]!, ...patch };
        for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
        p.budget[i] = next;
      }
    });
  const addItem = (group: string) => {
    const id = newId();
    // a category added next to your savings is saving up, not spending you keep after you retire
    const saving = cats.some((c) => c.group === group && c.kind === "saving");
    update((p) => {
      // after the group's last shown category; a new group goes before the hidden ones (they stay at the end)
      const firstHidden = p.budget.findIndex((x) => x.hidden);
      const last = p.budget.map((x, i) => (!x.hidden && groupOf(x) === group ? i : -1)).filter((i) => i >= 0).at(-1) ?? (firstHidden < 0 ? p.budget.length : firstHidden) - 1;
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
      <Screen title="Budget" subtitle={compact ? undefined : "Plan where your money goes"}>
        <Card style={{ gap: space.md }}>
          <Text style={[type.title, { color: t.text }]}>Start your monthly budget</Text>
          <Text style={[type.body, { color: t.text2 }]}>
            Each month, you decide where your money goes: bills, spending, debt payments and savings. What you don't spend stays put for next month. What you put toward savings and debts is what your plan counts as done.
          </Text>
          <Text style={[type.body, { color: t.text2 }]}>
            Your first money to assign is the cash in your accounts today: <Text style={{ color: t.text, fontWeight: "700" }}>{money(cashNow)}</Text>. Your categories come from your budget, bills, debts and savings, with amounts from your plan.
          </Text>
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            <Button title={`Start with ${monthLabel(start, 0, true)}`} tone="primary" icon="plus" onPress={startBudget} />
            <Button title="Import from YNAB" icon="database" onPress={() => openPage("/money/import")} />
          </View>
        </Card>
      </Screen>
    );
  }

  /* ---------- the month ---------- */
  const groups: { name: string; kind: BudgetCategory["kind"]; cats: BudgetCategory[] }[] = [];
  // a bill or debt payment listed in one of your groups goes where that group is, not with the built-ins
  const own = groupOrder(state.budget);
  const rank = (c: BudgetCategory) => (own.includes(c.group) ? ORDER.spending * 1000 + own.indexOf(c.group) : ORDER[c.kind] * 1000);
  // hidden categories aren't in the groups: they're listed at the end (an overspent one always shows)
  const hiddenCats = cats.filter((c) => c.hidden);
  const overHidden = hiddenCats.filter((c) => view.lines[c.key]!.available < -0.005);
  for (const c of [...cats].filter((x) => !x.hidden).sort((x, y) => rank(x) - rank(y))) {
    let g = groups.find((x) => x.name === c.group);
    if (!g) groups.push((g = { name: c.group, kind: c.kind, cats: [] }));
    g.cats.push(c);
  }
  const groupNames = [...new Set([...groups.map((g) => g.name), ...groupOrder(state.budget)])];
  /**
   * One of your groups (it has categories you made) can be moved, and its categories dragged, even with a
   * bill or debt payment listed in it: those rows stay put at the top. The built-in groups keep their place.
   */
  const ownGroup = (g: (typeof groups)[number]) => own.includes(g.name);
  const spendCats = (g: (typeof groups)[number]) => g.cats.filter((c) => c.kind === "spending");
  dragGroups.current = groups.filter(ownGroup).map((g) => ({ name: g.name, cats: spendCats(g) }));
  const rta = view.readyToAssign;
  // overspent categories (red): Unassigned doesn't count them, so they come first
  const red = cats.filter((c) => view.lines[c.key]!.available < -0.005);
  // what's left on cards as debt doesn't come out of next month
  const onCardsTotal = red.reduce((a, c) => a + (view.lines[c.key]!.toDebt ?? 0), 0);
  const redTotal = red.reduce((a, c) => a - view.lines[c.key]!.available, 0) - onCardsTotal;
  // went over last month: it reset to $0 and came out of this month's Unassigned, so it's tagged here
  const prevMonth = shift(month, -1);
  const prevView = month > b.start ? budgetView(b, cats, prevMonth, { txns, cards, asOf: isoDay(start) }) : null;
  // (overspending you left on a card as debt didn't come out of this month, so it isn't counted)
  const lastOver = prevView ? cats.flatMap((c) => { const l = prevView.lines[c.key]; const over = l ? -l.available - (l.toDebt ?? 0) : 0; return over > 0.005 ? [{ c, amount: over }] : []; }) : [];
  const lastOverTotal = lastOver.reduce((a, x) => a + x.amount, 0);
  const overLast = new Map(lastOver.map((x) => [x.c.key, x.amount]));
  // your real spending: categories whose recent average is well off the plan amount
  const realRows = showReal && history.months.length
    ? cats
        .filter((c) => c.kind === "spending" && !c.account && !c.hidden && history.avg[c.key] !== undefined)
        .map((c) => ({ c, avg: Math.round(history.avg[c.key]!), plan: c.target }))
        .filter((r) => Math.abs(r.avg - r.plan) >= Math.max(10, r.plan * 0.1))
        // you kept your own amount after seeing this: only flag it again if spending moved well away
        .filter((r) => {
          const kept = state.budget.find((x) => x.id === r.c.key)?.keptAt;
          return kept === undefined || Math.abs(r.avg - kept) >= Math.max(10, kept * 0.1);
        })
        .sort((x, y) => Math.abs(y.avg - y.plan) - Math.abs(x.avg - x.plan))
    : [];
  const realBy = new Map(realRows.map((r) => [r.c.key, r]));
  const realSpan = history.months.length === 0 ? "" : history.months.length === 1 ? nameOf(history.months[0]!) : `${nameOf(history.months[0]!)} to ${nameOf(history.months.at(-1)!)}`;
  const realNet = realRows.reduce((x, r) => x + r.avg - r.plan, 0);
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

  // Unassigned, small, in the bar that stays put: still in view while you assign further down
  const rtaColor = rta < -0.5 ? t.bad : rta > 0.5 ? t.good : t.text2;
  const unassignedChip = (
    <View accessibilityLabel={`Unassigned ${money(rta)}`} style={[styles.unassigned, compact ? { alignSelf: "flex-start" } : null]}>
      <Text style={[type.caption, { color: t.text3 }]}>Unassigned</Text>
      <Text style={[type.label, { color: rtaColor, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(rta)}</Text>
    </View>
  );

  const rtaCard = (
    <Card style={{ gap: space.sm, borderColor: rta < -0.5 ? t.bad : rta > 0.5 ? t.good : t.border, backgroundColor: rta < -0.5 ? t.badSoft : t.surface }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 160 }}>
          <Text style={[type.label, { color: t.text3 }]}>Unassigned</Text>
          <Text style={[type.display, { color: rta < -0.5 ? t.bad : rta > 0.5 ? t.good : t.text, fontVariant: ["tabular-nums"] }]}>{money(rta)}</Text>
          <Text style={[type.caption, { color: t.text3 }]}>
            {rta < -0.5 ? "You've assigned more than you have. Take some back from a category." : rta > 0.5 ? "Assign it to your categories below." : "All of it is assigned."}
            {view.assignedLater > 0.5 ? ` ${money(view.assignedLater)} is already assigned to later months.` : ""}
            {lastOver.length
              ? ` ${lastOver.length === 1 ? label(lastOver[0]!.c) : `${lastOver.length} categories`} went ${money(lastOverTotal)} over in ${MON[Number(prevMonth.slice(5, 7)) - 1]}; it came out of this month.${view.overspentBefore - lastOverTotal > 0.5 ? ` (${money(view.overspentBefore - lastOverTotal)} more from earlier months.)` : ""}`
              : view.overspentBefore > 0.5 ? ` ${money(view.overspentBefore)} went to overspending in earlier months.` : ""}
            {red.length && redTotal > 0.005 ? ` ${red.length === 1 ? `${label(red[0]!)} is` : `${red.length} categories are`} overspent by ${money(redTotal)}: cover ${red.length === 1 ? "it" : "them"}, or it comes out of next month.` : ""}
            {onCardsTotal > 0.005 ? ` ${money(onCardsTotal)} of overspending is left on your cards as debt.` : ""}
            {view.uncategorized ? ` Includes ${money(view.uncategorized)} not categorized yet: it moves to its category when you pick one.` : ""}
          </Text>
        </View>
      </View>
    </Card>
  );

  const COLW = compact ? 80 : 108;
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
      if (it.hidden)
        return (
          <View style={styles.section}>
            <Text style={[type.overline, { color: t.text3 }]}>Hidden category</Text>
            <FormList>
              <FormRow label="Name">
                <InlineText label="Category name" placeholder="e.g. Moving" value={it.name} onChange={(v) => editItem(it.id, { name: v })} />
              </FormRow>
              <FormRow label="Show on budget" hint="Pick the group it goes in">
                <Select
                  plain
                  label="Show on budget in group"
                  value=""
                  placeholder="Choose a group"
                  options={groupNames.map((g) => ({ value: g, label: g }))}
                  onChange={(g) => {
                    setOpen(null);
                    update((p) => {
                      p.budget = setHidden(p.budget, it.id, false);
                      p.budget = moveToGroup(p.budget, p.budget.findIndex((x) => x.id === it.id), g);
                    });
                  }}
                />
              </FormRow>
            </FormList>
            <Text style={[type.caption, { color: t.text3 }]}>Not on your budget and not in your plan. Its transactions stay in it.</Text>
            <View style={styles.chips}>
              <Chip
                title="Delete"
                icon="trash"
                tone="danger"
                onPress={async () => {
                  if (await confirm(`Delete "${it.name || "this category"}"?`, "Its transactions are kept but won't have a category.", "Delete")) {
                    setOpen(null);
                    update((p) => { p.budget = p.budget.filter((x) => x.id !== it.id); });
                  }
                }}
              />
            </View>
          </View>
        );
      const linkable = linkableAccounts(state);
      const linkedTo = linkable.find((a) => a.id === it.accountId);
      return (
        <View style={styles.section}>
          <Text style={[type.overline, { color: t.text3 }]}>Category</Text>
          {combined?.into === it.id ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, borderRadius: radius.sm, backgroundColor: t.accentSoft }}>
              <Text style={[type.caption, { color: t.text, flex: 1 }]}>"{combined.name}" combined into this one.</Text>
              <Pressable role="button" onPress={() => { combined.undo(); setOpen(null); setCombined(null); }} hitSlop={8}>
                <Text style={[type.label, { color: t.accent, fontWeight: "700" }]}>Undo</Text>
              </Pressable>
            </View>
          ) : null}
          <FormList>
            <FormRow label="Name">
              <InlineText label="Category name" placeholder="e.g. Groceries" value={it.name} onChange={(v) => editItem(it.id, { name: v })} />
            </FormRow>
            <FormRow
              label="Spending or investing?"
              hint={linkedTo ? `Money you move into ${linkedTo.name.trim() || "the account"}: it counts as investing, not spending, so it doesn't raise your retirement number` : "Spending. If this is money you put into an account (an IRA, a brokerage), pick the account"}
            >
              <Select
                plain
                label="Spending or investing"
                value={linkedTo?.id ?? ""}
                options={[{ value: "", label: "Spending" }, ...linkable.map((a) => ({ value: a.id, label: `Investing in ${a.name.trim() || "account"}` }))]}
                onChange={(v) => linkItem(it.id, v)}
              />
            </FormRow>
            {linkedTo ? null : (
              <FormRow
                label="Pays a loan?"
                hint={it.paysDebt ? "Counted from Debts, not as spending" : "Pick the loan it pays, so it isn't counted twice"}
              >
                <Select
                  plain
                  label="Pays a loan"
                  value={it.paysDebt ?? ""}
                  options={[{ value: "", label: "No" }, ...state.debts.filter((x) => !isCard(x) && !x.payroll).map((x) => ({ value: x.id, label: `${debtLabel(x)} · ${debtKind(x.kind).label}` }))]}
                  onChange={(v) => editItem(it.id, v ? { paysDebt: v } : { paysDebt: undefined, noSuggest: true })}
                />
              </FormRow>
            )}
            {(() => {
              const loan = it.paysDebt ? state.debts.find((x) => x.id === it.paysDebt) : undefined;
              return loan ? (
                <FormRow label="Payment" hint={`From your ${debtLabel(loan)} ${debtKind(loan.kind).label.toLowerCase()}${loan.escrow ? ` (${money(loan.escrow)} of it taxes and insurance)` : ""}`}>
                  <Pressable role="link" onPress={() => openPage("/money/debts")} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(loan.minPayment)}</Text>
                    <Text style={[type.body, { color: t.accent, fontWeight: "600" }]}>Change</Text>
                    <Icon name="chevron" size={14} color={t.accent} />
                  </Pressable>
                </FormRow>
              ) : (
                <FormRow label="Each month" hint={linkedTo ? `What you put into ${linkedTo.name.trim() || "the account"} each month` : "What your plan expects"}>
                  <InlineMoney label={`${it.name || "Item"} planned each month`} value={it.amount} onChange={(v) => editItem(it.id, { amount: v })} />
                </FormRow>
              );
            })()}
            {linkedTo ? null : (
              <FormRow
                label="Retirement & essentials"
                hint={`${it.inRetirement ? "Still paid after you retire" : "Not paid after you retire"} · ${it.essential !== false ? "Essential" : "Not essential"}`}
              >
                <Pressable role="link" onPress={() => router.navigate("/plan?view=retirement")} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                  <Text style={[type.body, { color: t.accent, fontWeight: "600" }]}>Change</Text>
                  <Icon name="chevron" size={14} color={t.accent} />
                </Pressable>
              </FormRow>
            )}
            <FormRow label="Group">
              <Select plain label="Group" value={groupOf(it)} options={groupNames.map((g) => ({ value: g, label: g }))} onChange={(g) => update((p) => { p.budget = moveToGroup(p.budget, itemIndex(it.id), g); })} />
            </FormRow>
            <FormRow label="Combine into" hint="Moves everything into another category">
              <Select
                plain
                label="Combine into"
                value=""
                placeholder="Choose"
                options={state.budget.filter((x) => x.id !== it.id && !x.hidden).map((x) => ({ value: x.id, label: x.name.trim() || "Unnamed", hint: groupOf(x) }))}
                onChange={async (to) => {
                  const into = state.budget.find((x) => x.id === to);
                  if (!into) return;
                  const name = it.name.trim() || "this category";
                  const n = txnsIn(txns, it.id);
                  const moves = n ? `Its ${n} transaction${n === 1 ? "" : "s"} and what you assigned move` : "What you assigned moves";
                  if (!(await confirm(`Combine "${name}" into "${into.name.trim() || "Unnamed"}"?`, `${moves} over, and "${name}" is removed. You can undo it right after.`, "Combine"))) return;
                  const undo = combineCategories(it.id, into.id);
                  setOpen(into.id);
                  setCombined({ into: into.id, name, undo });
                }}
              />
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
            <Text style={[type.caption, { color: t.text3, flex: 1 }]}>{compact ? "Tap Reorder above the categories, then drag a grip to move one." : "Drag a category's grip to reorder it or move it to another group."}</Text>
            {linkedTo ? null : (
              <Chip
                title="Hide"
                icon="close"
                onPress={async () => {
                  if (!(await confirm(`Hide "${it.name || "this category"}"?`, "It leaves your budget and your plan, but keeps its transactions. Find it under Hidden at the bottom of the budget. An overspent one still shows until you cover it.", "Hide"))) return;
                  setOpen(null);
                  update((p) => { p.budget = setHidden(p.budget, it.id, true); });
                }}
              />
            )}
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
    const id = c.key.slice(5); // "goal:<id>" / "debt:<id>"
    const linked = isBill ? state.goals.find((g) => g.id === id) : state.debts.find((x) => x.id === id);
    const fallback = isBill ? BILLS_GROUP : DEBTS_GROUP;
    const setGroup = (g: string) =>
      update((p) => {
        const x = isBill ? p.goals.find((y) => y.id === id) : p.debts.find((y) => y.id === id);
        if (!x) return;
        if (g === fallback) delete x.budgetGroup;
        else x.budgetGroup = g;
      });
    return (
      <View style={styles.section}>
        {linked ? (
          <FormList>
            <FormRow label="Group">
              <Select plain label="Group" value={linked.budgetGroup?.trim() || fallback} options={linkedGroupChoices(state.budget, fallback, linked.budgetGroup).map((g) => ({ value: g, label: g }))} onChange={setGroup} />
            </FormRow>
          </FormList>
        ) : null}
        <Pressable role="link" onPress={() => router.push(isBill ? "/money/goals" : "/money/debts")} hitSlop={6} style={styles.link}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{isBill ? "Change this bill (Savings goals)" : "Change this debt (Debts)"}</Text>
          <Icon name="chevron" size={12} color={t.accent} />
        </Pressable>
      </View>
    );
  };

  const line = (c: BudgetCategory, grip?: ReactNode) => {
    const l = view.lines[c.key]!;
    const debtOf = c.kind === "debt" ? state.debts.find((y) => "debt:" + y.id === c.key) : undefined;
    // a loan paid from one of your categories: listed here, but its money is in that category
    if (c.paidBy) {
      const by = cats.find((x) => x.key === c.paidBy);
      return (
        <View key={c.key} nativeID={"cat-" + c.key}>
          <Pressable
            role="link"
            accessibilityLabel={`${label(c)}: paid from ${by?.name ?? "a category"}. Open it`}
            onPress={() => { setOpen(c.paidBy!); if (Platform.OS === "web" && typeof document !== "undefined") setTimeout(() => document.getElementById("cat-" + c.paidBy)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}
            style={({ pressed }) => [styles.row, compact ? { paddingHorizontal: space.md } : null, pressed ? { backgroundColor: t.surface2 } : null]}
          >
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
              {grip}
              <View style={{ flexShrink: 1, minWidth: 0 }}>
                <Text style={[type.body, { color: t.text2 }]} numberOfLines={1}>{label(c)}</Text>
                <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>
                  {debtOf ? `${debtKind(debtOf.kind).label} · ` : ""}paid from <Text style={{ color: t.accent, fontWeight: "700" }}>{by?.name ?? "a category"}</Text>{by && by.group !== c.group ? ` (${by.group})` : ""}
                </Text>
              </View>
            </View>
            <Icon name="chevron" size={14} color={t.accent} />
          </Pressable>
        </View>
      );
    }
    const paysLoanLine = c.paysDebt ? state.debts.find((y) => y.id === c.paysDebt) : undefined;
    const isOpen = open === c.key;
    const dupItem = c.kind === "spending" && !c.account ? state.budget.find((x) => x.id === c.key) : undefined;
    const dup = dupItem && !dupItem.noSuggest ? suggestedAccount(state, c.name) : undefined;
    // a category that pays one of your loans (a mortgage's PITI): linked, or likely to be
    const paysLoan = dupItem?.paysDebt ? state.debts.find((x) => x.id === dupItem.paysDebt) : undefined;
    const loan = !dup && dupItem ? debtItPays(state, dupItem) : undefined;
    const newPay = paysLoan && dupItem ? newLoanPayment(paysLoan, dupItem, paidLastTwoMonths(txns, dupItem.id, thisMonth)) : undefined;
    return (
      <View key={c.key} nativeID={"cat-" + c.key}>
        <Pressable role="button" aria-expanded={isOpen} accessibilityLabel={`${label(c)}: ${money(l.available)} available`} onPress={() => { setOpen(isOpen ? null : c.key); }} style={({ pressed }) => [styles.row, compact ? { paddingHorizontal: space.md } : null, pressed ? { backgroundColor: t.surface2 } : null]}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
            {grip}
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{label(c)}</Text>
              {/* phones: under the name, so the name keeps its line */}
              {overLast.has(c.key) && compact ? (
                <Text style={[type.caption, { color: t.bad, fontWeight: "700", fontVariant: ["tabular-nums"] }]} numberOfLines={1}>−{money(overLast.get(c.key)!)} over last month</Text>
              ) : null}
              {debtOf ? <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>{debtKind(debtOf.kind).label}</Text> : null}
              {paysLoanLine ? <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>Pays {debtLabel(paysLoanLine)} {debtKind(paysLoanLine.kind).label.toLowerCase()}</Text> : null}
              {(l.toDebt ?? 0) > 0.005 ? (
                <Text style={[type.caption, { color: t.bad, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{money(l.toDebt!)} left as card debt</Text>
              ) : null}
              {cardShort(c, l) > 0.5 ? (
                <Text style={[type.caption, { color: t.bad, fontWeight: "700", fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{money(cardShort(c, l))} short of the balance</Text>
              ) : null}
            </View>
            {dup || loan || newPay !== undefined ? <Icon name="info" size={14} color={t.warn} /> : null}
            {realBy.has(c.key) ? (
              <View style={[styles.realTag, { backgroundColor: t.warnSoft }]} accessibilityLabel={`You really spend about ${money(realBy.get(c.key)!.avg, { whole: true })} a month`}>
                <Text style={[type.caption, { color: t.warn, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>~{money(realBy.get(c.key)!.avg, { whole: true })}</Text>
              </View>
            ) : null}
            {overLast.has(c.key) && !compact ? (
              <View style={[styles.realTag, { backgroundColor: t.badSoft }]} accessibilityLabel={`Went ${money(overLast.get(c.key)!)} over last month`}>
                <Text style={[type.caption, { color: t.bad, fontWeight: "700", fontVariant: ["tabular-nums"] }]} numberOfLines={1}>−{money(overLast.get(c.key)!)} last month</Text>
              </View>
            ) : null}
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
            {loan ? (
              <View style={[styles.dupBox, { backgroundColor: t.warnSoft, borderColor: t.warn }]}>
                <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Does this pay your {debtLabel(loan)} {loan.kind === "mortgage" ? "mortgage" : "loan"}?</Text>
                <Text style={[type.caption, { color: t.text2 }]}>
                  Its payment is {money(loan.minPayment)} a month, already in your plan from Debts. Right now this category counts too, so the payment is counted twice (in your retirement number too). Link it and it's counted once.
                </Text>
                <View style={styles.chips}>
                  <Chip title="Yes, link it" tone="accent" icon="check" onPress={() => editItem(c.key, { paysDebt: loan.id })} />
                  <Chip title="It's something else" icon="close" onPress={() => editItem(c.key, { noSuggest: true })} />
                </View>
              </View>
            ) : null}
            {paysLoan && newPay !== undefined ? (
              <View style={[styles.dupBox, { backgroundColor: t.warnSoft, borderColor: t.warn }]}>
                <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Your payment changed?</Text>
                <Text style={[type.caption, { color: t.text2 }]}>
                  You've paid {money(newPay)} the last two months; your {debtLabel(paysLoan)} {debtKind(paysLoan.kind).label.toLowerCase()} says {money(paysLoan.minPayment)}.
                  {paysLoan.kind === "mortgage" && (paysLoan.escrow ?? 0) > 0 ? " Usually that's taxes or insurance going up or down, so the escrow part changes with it." : ""}
                </Text>
                <View style={styles.chips}>
                  <Chip title={`Update to ${money(newPay)}`} tone="accent" icon="check" onPress={() => update((p) => { const x = p.debts.find((y) => y.id === paysLoan.id); if (x) setLoanPayment(x, newPay); })} />
                  <Chip title={`Keep ${money(paysLoan.minPayment)}`} icon="close" onPress={() => editItem(c.key, { keptAt: newPay })} />
                </View>
              </View>
            ) : null}
            {paysLoan ? (
              <View style={{ gap: 4 }}>
                <Text style={[type.caption, { color: t.text2 }]}>
                  Pays your {debtLabel(paysLoan)} {paysLoan.kind === "mortgage" ? "mortgage" : "loan"}. Your plan counts it from Debts: the payment until it's paid off{paysLoan.kind === "mortgage" ? ", then the home's taxes and insurance" : ""}. So this category isn't counted again in your spending or retirement number.
                </Text>
                <Text role="button" onPress={() => editItem(c.key, { paysDebt: undefined, noSuggest: true })} style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Unlink</Text>
              </View>
            ) : null}
            <View style={styles.section}>
              <Text style={[type.overline, { color: t.text3 }]}>{nameOf(month)}</Text>
              {/* this month's money: what you give it, and buttons that change that */}
              <FormList>
                <FormRow
                  label="Assigned"
                  hint={
                    c.target > 0.5 || l.available < -0.005 || l.assigned < -0.005 ? (
                      <>
                        {l.assigned < -0.005 ? `Took back ${money(-l.assigned)}${c.target > 0.5 || l.available < -0.005 ? " · " : ""}` : ""}
                        {c.target > 0.5 ? `Plan: ${money(c.target, { whole: true })}` : ""}
                        {c.target > 0.5 && Math.abs(l.assigned - c.target) > 0.5 ? (
                          <>
                            {" · "}
                            <Text role="button" onPress={() => setAssigned(c.key, Math.round(c.target * 100) / 100)} style={{ color: t.accent, fontWeight: "700" }}>Assign it</Text>
                          </>
                        ) : null}
                        {l.available < -0.005 ? (
                          <>
                            {c.target > 0.5 ? " · " : ""}
                            <Text role="button" onPress={() => setAssigned(c.key, l.assigned - l.available)} style={{ color: t.accent, fontWeight: "700" }}>Cover {money(-l.available)}</Text>
                          </>
                        ) : null}
                      </>
                    ) : undefined
                  }
                >
                  <InlineMoney label={`${label(c)} assigned in ${nameOf(month)}`} value={l.assigned} onChange={(v) => setAssigned(c.key, v)} allowNegative={(l.carried ?? 0) > 0.005 || l.assigned < 0} />
                </FormRow>
              </FormList>
              {overOnCards(l) > 0.005 ? (
                <View style={[styles.dupBox, { backgroundColor: t.badSoft, borderColor: t.bad }]}>
                  <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>
                    Went {money(-l.available)} over{Object.keys(l.onCards ?? {}).length === 1 ? ` on ${cardName(Object.keys(l.onCards!)[0]!)}` : " on your cards"}
                  </Text>
                  <Text style={[type.caption, { color: t.text2 }]}>
                    {(l.toDebt ?? 0) > 0.005
                      ? `${money(l.toDebt!)} stays on the card as debt: the card's payment line shows it short until you set money aside for it. Next month's Unassigned isn't touched.`
                      : "Cover it from another category, or it comes out of next month's Unassigned. Or leave it on the card as debt: the card's payment line then shows it short."}
                  </Text>
                  <View style={styles.chips}>
                    <Chip title={`Cover ${money(-l.available)}`} onPress={() => { setCardDebt(c.key, l, false); setAssigned(c.key, l.assigned - l.available); }} />
                    <Chip title="Take from next month" tone={(l.toDebt ?? 0) > 0.005 ? "neutral" : "accent"} icon={(l.toDebt ?? 0) > 0.005 ? undefined : "check"} onPress={() => setCardDebt(c.key, l, false)} />
                    <Chip title="Leave on card as debt" tone={(l.toDebt ?? 0) > 0.005 ? "accent" : "neutral"} icon={(l.toDebt ?? 0) > 0.005 ? "check" : undefined} onPress={() => setCardDebt(c.key, l, true)} />
                  </View>
                </View>
              ) : null}
              {/* what went out, and what you really spend (with links to change or keep the plan amount) */}
              <FormList>
                <FormRow label={c.moves ? "Paid" : "Spent"} hint={c.moves ? "From the payment or transfer you record" : "From transactions"}>
                  <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(l.spent)}</Text>
                </FormRow>
                {realBy.has(c.key) ? (
                  <FormRow
                    label="You really spend"
                    hint={
                      <>
                        {`About this a month (${realSpan}) · `}
                        <Text role="button" onPress={() => editItem(c.key, { amount: realBy.get(c.key)!.avg, keptAt: undefined })} style={{ color: t.accent, fontWeight: "700" }}>Use as plan</Text>
                        {" · "}
                        <Text role="button" onPress={() => editItem(c.key, { keptAt: realBy.get(c.key)!.avg })} style={{ color: t.accent, fontWeight: "700" }}>Keep {money(realBy.get(c.key)!.plan, { whole: true })}</Text>
                      </>
                    }
                  >
                    <Text style={[type.body, { color: t.warn, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(realBy.get(c.key)!.avg, { whole: true })}</Text>
                  </FormRow>
                ) : null}
              </FormList>
              <FormList>
                <FormRow label="Available" hint={l.carried > 0.5 ? `${money(l.carried)} carried over` : (l.funded ?? 0) > 0.5 ? `+${money(l.funded ?? 0)} from card spending` : undefined}>
                  <Text style={[type.body, { color: l.available < -0.005 ? t.bad : l.available > 0.5 ? t.good : t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(l.available)}</Text>
                </FormRow>
              </FormList>
            </View>
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
              {overLast.has(c.key) ? `It went ${money(overLast.get(c.key)!)} over last month: that came out of this month's Unassigned. Assign a little more if it keeps happening. ` : ""}
              {c.kind === "saving" && c.moves
                ? "Stays available until you record the transfer to the account (Transaction → Transfer). Your plan uses what you assign here."
                : c.kind === "saving"
                  ? "Stays here and builds up. Your plan uses what you assign here."
                  : c.kind === "debt" && cards[c.key.slice(5)] !== undefined
                    ? `Spending on this card moves money here from its categories${(l.funded ?? 0) > 0.5 ? ` (${money(l.funded ?? 0)} this month)` : ""}, so the payment is covered.${(l.uncovered ?? 0) > 0.5 ? ` ${money(l.uncovered!)} of overspending was left on this card as debt this month, so it holds that much less.` : ""}${cardShort(c, l) > 0.5 ? ` You owe ${money(cardShort(c, l))} more than is set aside: assign it here to pay the card in full.` : " Assign more to pay down what you already owe."} A payment (a transfer from checking) spends it.`
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
    <Screen title="Budget" subtitle={compact ? undefined : "Plan where your money goes"}>
      {view.started ? (
      <View onLayout={(e) => setBarH(Math.round(e.nativeEvent.layout.height))} style={[styles.toolbar, sticky(0, t.bg)]}>
            <View style={{ flexGrow: 1, flexShrink: 1, maxWidth: 440 }}>
              <Segmented
                label="Budget view"
                options={[{ value: "categories", label: "Categories" }, { value: "transactions", label: `${compact ? "Activity" : "Transactions"}${needsCount + reviewCount ? ` · ${needsCount + reviewCount}` : ""}` }, { value: "accounts", label: "Accounts" }]}
                value={tab}
                onChange={(v) => { setTab(v); if (v !== "transactions" && (acctParam || viewParam || needsParam || reviewParam)) router.setParams({ account: undefined, view: undefined, needs: undefined, review: undefined }); }}
              />
            </View>
            {tab === "categories" && rtaHidden && !compact ? unassignedChip : null}
            {compact ? (
              <Pressable role="button" accessibilityLabel="Add a transaction" onPress={() => setAdding({})} hitSlop={6} style={({ pressed }) => [styles.addRound, { backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 }]}>
                <Icon name="plus" size={18} color="#fff" />
              </Pressable>
            ) : (
              <Button title="Add a transaction" icon="plus" tone="primary" onPress={() => setAdding({})} style={{ minHeight: 36 }} />
            )}
            {tab === "categories" && rtaHidden && compact ? <View style={{ width: "100%" }}>{unassignedChip}</View> : null}
      </View>
      ) : null}
      <ImportUndoReminder />
      {/* Categories and Accounts: what's waiting on you in Activity (Activity has the same chips over its list) */}
      {view.started && tab !== "transactions" && (reviewCount || needsCount) ? (
        <View style={styles.chipRow}>
          {reviewCount ? (
            <Pressable role="link" onPress={() => openList("review")} hitSlop={4} style={[styles.waitChip, { borderColor: t.accent, backgroundColor: t.accentSoft }]}>
              <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>To review · {reviewCount}</Text>
            </Pressable>
          ) : null}
          {needsCount ? (
            <Pressable role="link" onPress={() => openList("needs")} hitSlop={4} style={[styles.waitChip, { borderColor: t.warn, backgroundColor: t.warnSoft }]}>
              <Text style={[type.caption, { color: t.text, fontWeight: "700" }]}>Needs a category · {needsCount}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {!view.started || tab !== "accounts" ? monthBar : null}
      {view.started && tab === "transactions" ? (
        <TransactionsList key={(acctParam ?? "all") + (needsParam ?? "") + (reviewParam ?? "")} month={month} account={acctParam} onlyNeedsCategory={needsParam === "1"} onlyReview={reviewParam === "1"} stickyTop={barH} onAccountChange={setListAcct} />
      ) : view.started && tab === "accounts" ? (
        <BudgetAccounts onTransfer={(from) => setAdding({ from })} stickyTop={barH} />
      ) : view.started ? (
        <>
          <View ref={rtaRef as never}>{rtaCard}</View>
          {realRows.length ? (
            <Card style={{ gap: space.sm, paddingVertical: space.md }}>
              <View style={[styles.realHead]}>
                <View style={[styles.realDot, { backgroundColor: t.warn }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.body, { color: t.text, fontWeight: "700" }]}>
                    {realRows.length} {realRows.length === 1 ? "category doesn't" : "categories don't"} match what you spend
                  </Text>
                  <Text style={[type.caption, { color: t.text2 }]}>
                    {Math.abs(realNet) < 0.5
                      ? `Some higher, some lower than your plan (${realSpan} average)`
                      : `You spend about ${money(Math.abs(realNet), { whole: true })}/mo ${realNet > 0 ? "more" : "less"} than your plan (${realSpan} average)`}
                  </Text>
                </View>
                <Chip title={realOpen ? "Hide" : "Review"} tone="accent" onPress={() => setRealOpen((v) => !v)} />
              </View>
              {realOpen ? (
                <>
                  <Text style={[type.caption, { color: t.text3 }]}>
                    What you spent a month on average ({realSpan}, {history.months.length} full month{history.months.length === 1 ? "" : "s"}) against what your plan uses. Your plan, forecast and retirement number use the plan amounts, so update them to follow real life.
                  </Text>
                  {realRows.map((r) => (
                    <View key={r.c.key} style={[styles.realRow, { borderTopColor: t.border }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{label(r.c)}</Text>
                        <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]}>
                          Plan {money(r.plan, { whole: true })} · spent {money(r.avg, { whole: true })} ·{" "}
                          <Text style={{ color: r.avg > r.plan ? t.warn : t.good, fontWeight: "700" }}>{r.avg > r.plan ? "+" : "−"}{money(Math.abs(r.avg - r.plan), { whole: true })}</Text>
                        </Text>
                      </View>
                      <View style={styles.realChips}>
                        <Chip title={`Change plan to ${money(r.avg, { whole: true })}`} onPress={() => editItem(r.c.key, { amount: r.avg, keptAt: undefined })} />
                        <Chip title={`Keep plan at ${money(r.plan, { whole: true })}`} onPress={() => editItem(r.c.key, { keptAt: r.avg })} />
                      </View>
                    </View>
                  ))}
                  <View style={styles.chips}>
                    {realRows.length > 1 ? (
                      <Chip
                        title="Change all to what I spend"
                        tone="accent"
                        icon="check"
                        onPress={() => update((p) => { for (const r of realRows) { const it = p.budget.find((x) => x.id === r.c.key); if (it) { it.amount = r.avg; delete it.keptAt; } } })}
                      />
                    ) : null}
                    <Chip title="Don't compare" icon="close" onPress={() => { setShowReal(false); setRealOpen(false); }} />
                  </View>
                  <Text style={[type.caption, { color: t.text3 }]}>Turn it back on in Settings → Appearance.</Text>
                </>
              ) : null}
            </Card>
          ) : null}
          <View onLayout={(e) => setColH(Math.round(e.nativeEvent.layout.height))} style={[styles.colHead, { paddingHorizontal: compact ? space.md : space.lg }, sticky(barH, t.bg)]}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", gap: space.md }}>
              <Text style={[type.caption, styles.colName, { color: t.text3 }]}>Category</Text>
              {compact ? <ReorderToggle on={reorder} onChange={setReorder} /> : null}
            </View>
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
                  style={[styles.groupHead, { borderBottomColor: t.border }, compact ? { paddingHorizontal: space.md } : null, sticky(barH + colH, t.surface), { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }]}
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
                {ownGroup(g) ? (
                  <>
                    {g.cats.filter((c) => c.kind !== "spending").map((c, n) => (
                      <View key={c.key}>
                        {n > 0 ? <Divider /> : null}
                        {line(c)}
                      </View>
                    ))}
                    {g.cats.some((c) => c.kind !== "spending") && spendCats(g).length ? <Divider /> : null}
                    <DragList
                      zone={{ set: zone, id: g.name }}
                      grips={grips}
                      count={spendCats(g).length}
                      keyOf={(n) => spendCats(g)[n]!.key}
                      nameOf={(n) => spendCats(g)[n]!.name}
                      onMove={(from, to) => update((p) => { p.budget = reorderAmong(p.budget, (b) => !b.hidden && groupOf(b) === g.name, from, to); })}
                      renderItem={(n, grip) => (
                        <View>
                          {n > 0 ? <Divider /> : null}
                          {line(spendCats(g)[n]!, grip)}
                        </View>
                      )}
                    />
                  </>
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
          {hiddenCats.length ? (
            <Card padded={false}>
              <Pressable
                role="button"
                aria-expanded={hiddenOpen}
                accessibilityLabel={`Hidden categories (${hiddenCats.length}): ${hiddenOpen ? "hide the list" : "show them"}`}
                onPress={() => setHiddenOpen((v) => !v)}
                style={[styles.groupHead, { borderBottomColor: t.border }, compact ? { paddingHorizontal: space.md } : null]}
              >
                <Text style={[type.overline, { color: t.text2, flex: 1 }]} numberOfLines={1}>Hidden ({hiddenCats.length})</Text>
                <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{hiddenOpen ? "Hide list" : "Show"}</Text>
              </Pressable>
              {hiddenOpen ? (
                <Text style={[type.caption, { color: t.text3, paddingHorizontal: compact ? space.md : space.lg, paddingTop: space.sm }]}>
                  Off your budget and out of your plan, but they keep their transactions. One that's overspent shows here until you cover it.
                </Text>
              ) : null}
              {hiddenOpen ? (
                // two lists: your hidden categories, and the payment lines of accounts you've closed
                [
                  { title: "Categories", list: hiddenCats.filter((c) => c.group !== CLOSED_ACCOUNTS_GROUP) },
                  { title: CLOSED_ACCOUNTS_GROUP, list: hiddenCats.filter((c) => c.group === CLOSED_ACCOUNTS_GROUP) },
                ].filter((x) => x.list.length).map((x) => (
                  <View key={x.title}>
                    <Text style={[type.overline, { color: t.text3, paddingHorizontal: compact ? space.md : space.lg, paddingTop: space.md, paddingBottom: space.xs }]}>
                      {x.title} ({x.list.length})
                    </Text>
                    {x.list.map((c, n) => (
                      <View key={c.key}>
                        {n > 0 ? <Divider /> : null}
                        {line(c)}
                      </View>
                    ))}
                  </View>
                ))
              ) : (
                overHidden.map((c, n) => (
                  <View key={c.key}>
                    {n > 0 ? <Divider /> : null}
                    {line(c)}
                  </View>
                ))
              )}
            </Card>
          ) : null}
          <Pressable role="link" onPress={() => router.push("/settings")} hitSlop={6} style={styles.link}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Manage income, accounts, debts and goals</Text>
            <Icon name="chevron" size={12} color={t.accent} />
          </Pressable>
          <View style={styles.editRow}>
            <Button title="Add a group" icon="plus" onPress={addGroup} style={{ minHeight: 36 }} />
            <Button title={`Add to ${groupOrder(state.budget)[0] ?? UNGROUPED}`} icon="plus" tone="ghost" onPress={() => addItem(groupOrder(state.budget)[0] ?? UNGROUPED)} style={{ minHeight: 36 }} />
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>
            Still paid after you retire: {money(state.budget.filter((x) => x.inRetirement && !x.accountId && !x.hidden).reduce((a, x) => a + x.amount, 0))}/mo of spending (plus healthcare). That sets your retirement number.{" "}
            <Text role="link" onPress={() => router.navigate("/plan?view=retirement")} style={{ color: t.accent, fontWeight: "700" }}>Choose what's included</Text>. Bills come from repeating savings goals and debt payments from Debts; tap one to change it there. Spent and paid come from the transactions you record.
          </Text>
          {imported ? null : <Button title="Import from YNAB" icon="database" tone="ghost" onPress={() => openPage("/money/import")} style={{ alignSelf: "flex-start" }} />}
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
      {adding ? (
        <TxnForm
          txn={adding.txn}
          categoryId={adding.categoryId}
          initialKind={adding.kind}
          initialAmount={adding.amount}
          transferFrom={adding.from}
          accountId={!adding.txn && !adding.from && tab === "transactions" && listAcct !== "all" ? listAcct : undefined}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {month === thisMonth && i === 0 ? <View style={{ height: 1 }} /> : <Pill tone="neutral">{i > 0 ? "A future month: assign ahead if you like" : "A past month"}</Pill>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  waitChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  needsRow: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  realHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  realDot: { width: 8, height: 8, borderRadius: 4 },
  realTag: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  realChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" },
  realRow: { flexDirection: "row", alignItems: "center", gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  monthBar: { flexDirection: "row", alignItems: "center", gap: space.md },
  navBtn: { borderWidth: 1, borderRadius: 999, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  addRound: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  unassigned: { flexDirection: "row", alignItems: "baseline", gap: space.xs, marginLeft: "auto" },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space.sm, paddingVertical: space.sm, marginVertical: -space.sm },
  groupHead: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignItems: "flex-end", maxWidth: "100%" },
  colHead: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, marginBottom: -space.sm, paddingVertical: space.xs },
  colName: { fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3, fontSize: 11 },
  section: { gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  editor: { gap: space.md, marginHorizontal: space.md, marginBottom: space.md, padding: space.md, borderRadius: radius.md },
  editRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  dupBox: { gap: 6, borderWidth: 1, borderRadius: radius.md, padding: space.md },
  txnRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, minHeight: 46 },
  link: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
});
