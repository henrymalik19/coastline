import { monthsBetween, nextDue, setAsideFor, type BudgetItem, type Goal, type MonthRow } from "@coastfi/engine";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { confirm } from "../lib/confirm";
import { groupOf, mergeGroup, moveGroup, moveItem, moveToGroup, UNGROUPED } from "../lib/budgetOrder";
import { debtLabel } from "../lib/debts";
import { paycheckFor } from "../lib/loans";
import { monthKey } from "../lib/store";
import { goalFromItem, suggestFor, type Suggestion } from "../lib/budgetSuggest";
import { dueLabel, everyLabel } from "./RecurringGoalFields";
import { money, monthLabel } from "../lib/format";
import { HELP } from "../lib/help";
import { useLayout } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, InfoTip, NumberInput, TextField, Toggle } from "./form";
import { Icon } from "./Icon";
import { AddChip, MasterDetail, useFillPage, useTwoPane } from "./MasterDetail";
import { Card, Pill } from "./ui";

/** Key of the read-only "Debt payments" group (not a real budget group). */
const DEBT_KEY = "\u0000debts";
/** Key of the read-only "Set aside" group (recurring goals). */
const SET_KEY = "\u0000setaside";

/** Groups in the order they first appear; items without a group go under "Other". */
function grouped(items: BudgetItem[]) {
  const order: string[] = [];
  const map = new Map<string, { item: BudgetItem; index: number }[]>();
  items.forEach((item, index) => {
    const g = groupOf(item);
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g)!.push({ item, index });
  });
  return order.map((name) => {
    const rows = map.get(name)!;
    return { name, rows, subtotal: rows.reduce((a, r) => a + r.item.amount, 0) };
  });
}

/** Budget: groups on the right (pick one), that group's items on the left. Fills its container. */
export function BudgetEditor() {
  const t = useTheme();
  const { state, result, start, actual } = usePlan();
  const update = useStore((s) => s.update);
  // compact rows when the items pane itself is narrow (phones, or two panes on a mid-size window)
  const { contentWidth } = useLayout();
  const twoPane = useTwoPane();
  const fillPage = useFillPage();
  const [showDetails, setShowDetails] = useState(false);
  const [reorder, setReorder] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const paneWidth = twoPane ? contentWidth - 270 - space.md : contentWidth;
  const compact = paneWidth < 560;
  const cols = budgetCols(compact);
  const groups = grouped(state.budget);
  const [selected, setSelected] = useState<string | undefined>(groups[0]?.name);
  const [retireTip, setRetireTip] = useState(false);
  const names = groups.map((g) => g.name).join("|");
  // debt payments come from Debts: shown here as a read-only group so the budget lists everything
  // (a 401(k) loan repaid from a paycheck is already out of take-home, so it isn't a budget cost)
  const debtRows = state.debts.filter((x) => x.balance > 0 && x.minPayment > 0 && !x.payroll);
  const payrollLoans = state.debts.filter((x) => x.balance > 0 && x.payroll);
  const onDebts = selected === DEBT_KEY && debtRows.length > 0;
  // recurring goals are set aside every month, like a bill: shown read-only too
  const setRows = state.goals.filter((g) => g.recurring && g.target > 0);
  const onSet = selected === SET_KEY && setRows.length > 0;
  useEffect(() => {
    if (selected === DEBT_KEY && debtRows.length > 0) return;
    if (selected === SET_KEY && setRows.length > 0) return;
    if (!selected || !groups.some((g) => g.name === selected)) setSelected(groups[0]?.name);
  }, [names, debtRows.length, setRows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = onDebts || onSet ? undefined : groups.find((g) => g.name === selected) ?? groups[0];
  const retireMonthly = state.budget.filter((b) => b.inRetirement).reduce((a, b) => a + b.amount, 0);

  const newGroupName = () => {
    const existing = new Set(groups.map((g) => g.name));
    let name = "New group";
    for (let n = 2; existing.has(name); n++) name = `New group ${n}`;
    return name;
  };
  const addGroup = () => {
    const name = newGroupName();
    const id = newId();
    update((p) => { p.budget.push({ id, name: "", amount: 0, inRetirement: true, group: name }); });
    setSelected(name);
    setEditing(id);
  };
  const [editing, setEditing] = useState<string | null>(null);
  const addItem = (group: string) => {
    const id = newId();
    update((p) => {
      const last = p.budget.map((b, i) => (groupOf(b) === group ? i : -1)).filter((i) => i >= 0).at(-1) ?? p.budget.length - 1;
      p.budget.splice(last + 1, 0, { id, name: "", amount: 0, inRetirement: true, group });
    });
    setEditing(id); // a new item opens ready to fill in
  };
  const renameGroup = (from: string, to: string) => {
    update((p) => { p.budget.forEach((b) => { if (groupOf(b) === from) b.group = to; }); });
    setSelected(to);
    setNotice(null);
  };
  const removeGroup = async (group: string, count: number) => {
    if (await confirm(`Remove "${group}"?`, `This removes the group and its ${count} item${count === 1 ? "" : "s"}.`, "Remove"))
      update((p) => { p.budget = p.budget.filter((b) => groupOf(b) !== group); });
  };

  // what's left each month once the budget and debt minimums are paid (engine numbers, normal month)
  const d = result.d;
  // this month's set-aside, exactly (more if a goal is catching up, less if you saved ahead)
  const thisMonth = monthKey(start);
  const setAsideNow = state.goals.reduce((a, g) => a + setAsideFor(g, thisMonth), 0);
  const leftover = d.leanMonthly - d.budgetTotal - d.debtMins - setAsideNow;
  const figure = (label: string, value: string, sign?: "−" | "=") => (
    <View style={styles.figure}>
      {sign ? <Text style={[type.heading, { color: t.text3, marginRight: space.sm }]}>{sign}</Text> : null}
      <View>
        <Text style={[type.caption, { color: t.text3 }]}>{label}</Text>
        <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{value}</Text>
      </View>
    </View>
  );
  // phones: one compact line (what's left over, and the math in small print); details on tap
  const phoneHeader = (
    <Card style={{ gap: space.sm, paddingVertical: space.md }}>
      <View style={[styles.figure, { justifyContent: "space-between", gap: space.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: t.text2 }]}>{leftover < 0 ? "Short in a normal month" : "Left over in a normal month"}</Text>
          <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]} numberOfLines={2}>
            {money(d.leanMonthly)} take-home − {money(d.budgetTotal)} budget{d.debtMins > 0 ? ` − ${money(d.debtMins)} debts` : ""}
            {setAsideNow > 0 ? ` − ${money(setAsideNow)} set aside` : ""}
          </Text>
        </View>
        <Text style={[type.stat, { color: leftover < 0 ? t.bad : t.good, fontVariant: ["tabular-nums"] }]}>{money(leftover)}/mo</Text>
      </View>
      <Pressable role="button" aria-expanded={showDetails} onPress={() => setShowDetails((v) => !v)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{showDetails ? "Hide details" : "Details"}</Text>
        <View style={{ transform: [{ rotate: showDetails ? "90deg" : "0deg" }] }}>
          <Icon name="chevron" size={14} color={t.accent} />
        </View>
      </Pressable>
      {showDetails ? (
        <>
          <Text style={[type.caption, { color: t.text3 }]}>
            {leftover < 0
              ? "Your budget is more than you bring home in a normal month. Coasting only works once today's bills are covered."
              : "A normal month at today's numbers (two paychecks if you're paid every two weeks). Actual months can differ: 3-paycheck months, and more once debts are paid off. Home shows this month exactly."}
            {d.extraChecksPerYear > 1 ? ` Extra-paycheck months add about ${money(d.extraChecksPerYear)} a year on top.` : ""}
          </Text>
          <View style={[styles.totals, { borderTopColor: t.border }]}>
            <Text style={[type.caption, { color: t.text3 }]}>Still paid after you retire</Text>
            <Text style={[type.label, { color: t.text2, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(retireMonthly)}/mo</Text>
            <Text style={[type.caption, { color: t.text3, width: "100%" }]}>{HELP.inRetirement}</Text>
          </View>
        </>
      ) : null}
    </Card>
  );
  // the roomy summary only on tall desktop windows; phones, tablets and folds get the one-liner
  const header = !fillPage ? phoneHeader : (
    <Card style={{ gap: space.md }}>
      <View style={styles.flow} role="group" aria-label={`Take-home ${money(d.leanMonthly)} minus budget ${money(d.budgetTotal)} minus debt minimums ${money(d.debtMins)} leaves ${money(leftover)} a month`}>
        {figure("Take-home (normal month)", money(d.leanMonthly))}
        {figure("Budget", money(d.budgetTotal), "−")}
        {figure("Debt minimums", money(d.debtMins), "−")}
        {setAsideNow > 0 ? figure("Set aside", money(setAsideNow), "−") : null}
        <View style={[styles.figure, styles.result, { backgroundColor: leftover < 0 ? t.badSoft : t.goodSoft }]}>
          <Text style={[type.heading, { color: t.text3, marginRight: space.sm }]}>=</Text>
          <View>
            <Text style={[type.caption, { color: t.text2 }]}>{leftover < 0 ? "Short in a normal month" : "Left over in a normal month"}</Text>
            <Text style={[type.stat, { color: leftover < 0 ? t.bad : t.good, fontVariant: ["tabular-nums"] }]}>{money(leftover)}/mo</Text>
          </View>
        </View>
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>
        {leftover < 0
          ? "Your budget is more than you bring home in a normal month. Coasting only works once today's bills are covered."
          : "A normal month at today's numbers (two paychecks if you're paid every two weeks). Actual months can differ: 3-paycheck months, and more once debts are paid off. Home shows this month exactly."}
        {d.extraChecksPerYear > 1 ? ` Extra-paycheck months add about ${money(d.extraChecksPerYear)} a year on top.` : ""}
      </Text>
      <View style={[styles.totals, { borderTopColor: t.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={[type.caption, { color: t.text3 }]}>Still paid after you retire</Text>
          <InfoTip text={HELP.inRetirement} label="still paid after you retire" open={retireTip} onToggle={setRetireTip} />
        </View>
        <Text style={[type.label, { color: t.text2, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(retireMonthly)}/mo</Text>
        {retireTip ? <Text style={[type.caption, styles.tip, { color: t.text, backgroundColor: t.accentSoft }]}>{HELP.inRetirement}</Text> : null}
      </View>
    </Card>
  );

  return (
    <MasterDetail
      label="Budget groups"
      header={header}
      listTitle="Groups"
      items={[
        ...groups.map((g) => ({ key: g.name, title: g.name, subtitle: `${g.rows.length} item${g.rows.length === 1 ? "" : "s"}`, value: money(g.subtotal) })),
        ...(debtRows.length ? [{ key: DEBT_KEY, title: "Debt payments", subtitle: "From your debts", value: money(d.debtMins) }] : []),
        ...(setRows.length ? [{ key: SET_KEY, title: "Set aside", subtitle: "Recurring goals", value: money(setAsideNow) }] : []),
      ]}
      selected={onDebts ? DEBT_KEY : onSet ? SET_KEY : current?.name}
      onSelect={setSelected}
      listFooter={<Button title="Add group" icon="plus" tone="ghost" onPress={addGroup} style={{ alignSelf: "flex-start" }} />}
      chipAdd={<AddChip label="Group" onPress={addGroup} />}
      empty={
        <>
          <Text style={[type.body, { color: t.text3 }]}>No budget yet.</Text>
          <Button title="Add a group" icon="plus" tone="primary" onPress={addGroup} />
        </>
      }
      detailHead={
        onSet ? (
          <View>
            <View style={styles.headRow}>
              <Text role="heading" aria-level={2} style={[type.heading, { color: t.text, flex: 1 }]}>Set aside</Text>
              <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(setAsideNow)}/mo</Text>
            </View>
            <View style={[styles.cols, { paddingHorizontal: space.lg, paddingBottom: space.sm }]}>
              <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Goal</Text>
              <Text style={[type.overline, { color: t.text3, width: cols.amount, textAlign: "right" }]}>Monthly</Text>
              <View style={{ width: cols.actions }} />
            </View>
          </View>
        ) : onDebts ? (
          <View>
            <View style={styles.headRow}>
              <Text role="heading" aria-level={2} style={[type.heading, { color: t.text, flex: 1 }]}>Debt payments</Text>
              <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(d.debtMins)}/mo</Text>
            </View>
            <View style={[styles.cols, { paddingHorizontal: space.lg, paddingBottom: space.sm }]}>
              <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Debt</Text>
              <Text style={[type.overline, { color: t.text3, width: cols.amount, textAlign: "right" }]}>Monthly</Text>
              <View style={{ width: cols.actions }} />
            </View>
          </View>
        ) : current ? (
          <View>
            <View style={styles.headRow}>
              <GroupName
                key={current.name}
                name={current.name}
                onRename={(to) => renameGroup(current.name, to)}
                onRemove={() => removeGroup(current.name, current.rows.length)}
                others={groups.map((g) => g.name).filter((g) => g !== current.name)}
                onMerge={(into) => {
                  const n = current.rows.length;
                  update((p) => { p.budget = mergeGroup(p.budget, current.name, into); });
                  setSelected(into);
                  setNotice(`Merged ${current.name} into ${into} (${n} item${n === 1 ? "" : "s"}).`);
                }}
              />
              <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(current.subtotal)}/mo</Text>
              <Pressable
                role="button"
                accessibilityLabel={reorder ? "Done reordering" : "Reorder items and groups"}
                onPress={() => { setEditing(null); setReorder((r) => !r); }}
                hitSlop={6}
                style={[styles.reorderBtn, { borderColor: reorder ? t.accent : t.border, backgroundColor: reorder ? t.accentSoft : t.surface }]}
              >
                <Icon name={reorder ? "check" : "sliders"} size={14} color={t.accent} />
                <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{reorder ? "Done" : "Reorder"}</Text>
              </Pressable>
            </View>
            {reorder ? (
              <View style={[styles.reorderBar, { backgroundColor: t.accentSoft }]}>
                <Text style={[type.caption, { color: t.text, flex: 1 }]}>Move this group</Text>
                <Button title="Earlier" icon="up" disabled={groups[0]?.name === current.name} onPress={() => update((p) => { p.budget = moveGroup(p.budget, current.name, -1); })} style={styles.moveBtn} />
                <Button title="Later" icon="down" disabled={groups.at(-1)?.name === current.name} onPress={() => update((p) => { p.budget = moveGroup(p.budget, current.name, 1); })} style={styles.moveBtn} />
              </View>
            ) : null}
            <View style={[styles.cols, { paddingHorizontal: space.lg, paddingBottom: space.sm }]}>
              <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Item</Text>
              <Text style={[type.overline, { color: t.text3, width: cols.amount, textAlign: "right" }]}>Monthly</Text>
              {compact ? null : (
                <View style={{ width: cols.retire, alignItems: "center" }}>
                  <Text style={[type.overline, { color: t.text3, textAlign: "center", fontWeight: "600" }]}>After you retire?</Text>
                </View>
              )}
              <View style={{ width: reorder ? 84 : cols.actions }} />
            </View>
          </View>
        ) : undefined
      }
      detail={
        onSet
          ? setRows.map((g) => (
              <SetAsideRow key={g.id} goal={g} months={actual.months} start={start} thisMonth={thisMonth} cols={cols} />
            ))
          : onDebts
          ? debtRows.map((x) => {
              const link = paycheckFor(state, x.id);
              const from = link
                ? `From your ${link.income.name || "job"} paycheck (${money(link.deduction.amount)} per check)`
                : x.promoUntil
                  ? "Minimum payment · intro rate"
                  : "Minimum payment";
              return (
                <View key={x.id} style={[styles.row, { borderBottomColor: t.border }]}>
                  <View style={{ flex: 1, minWidth: 0, paddingVertical: 4 }}>
                    <Text numberOfLines={2} style={[type.body, { color: t.text }]}>{debtLabel(x)}</Text>
                    <Text style={[type.caption, { color: t.text3 }]}>{from}</Text>
                  </View>
                  <Text style={[type.body, { width: cols.amount, textAlign: "right", color: t.text, fontVariant: ["tabular-nums"] }]}>{money(x.minPayment)}</Text>
                  <View style={[styles.actions, { width: cols.actions }]} />
                </View>
              );
            })
          : current
          ? [
              !reorder ? (
                <Suggestions
                  key="suggestions"
                  items={current.rows.map((r) => r.item)}
                  notice={notice}
                  onDismissNotice={() => setNotice(null)}
                  onMove={(id, group) => update((p) => { const b = p.budget.find((x) => x.id === id); if (b) b.group = group; })}
                  onGoal={(id, recurring, december) => {
                    const b = state.budget.find((x) => x.id === id);
                    if (!b) return;
                    const goal = goalFromItem(b, recurring, december);
                    update((p) => {
                      p.budget = p.budget.filter((x) => x.id !== id);
                      p.goals.push(goal);
                    });
                    setNotice(`"${goal.name}" is now a ${recurring ? "recurring " : ""}savings goal (${money(goal.target)}${recurring ? " a year" : ""}). Check the amount under Savings goals.`);
                  }}
                  onDismiss={(id) => update((p) => { const b = p.budget.find((x) => x.id === id); if (b) b.noSuggest = true; })}
                />
              ) : null,
              ...current.rows.map(({ item, index }, i) => (
              <BudgetRow
                key={item.id}
                item={item}
                group={current.name}
                groups={groups.map((g) => g.name)}
                onMoveTo={(to) => {
                  const target = to === NEW_GROUP ? newGroupName() : to;
                  setEditing(null);
                  update((p) => { p.budget = moveToGroup(p.budget, index, target); });
                  setNotice(`Moved "${item.name || "item"}" to ${target}.${to === NEW_GROUP ? " Rename it with ✎." : ""}`);
                }}
                reorder={reorder ? { up: i > 0, down: i < current.rows.length - 1, move: (by) => update((p) => { p.budget = moveItem(p.budget, index, by); }) } : undefined}
                editing={editing === item.id}
                compact={compact}
                onEdit={() => setEditing(item.id)}
                onDone={() => setEditing(null)}
                onChange={(patch) => update((p) => { p.budget[index] = { ...p.budget[index]!, ...patch }; })}
                onRemove={() => { setEditing(null); update((p) => { p.budget.splice(index, 1); }); }}
              />
            )),
            ]
          : null
      }
      detailFooter={onSet ? (
        <Text style={[type.caption, { color: t.text3, padding: space.sm }]}>
          Your recurring goals, set aside a little each month so they're ready when due. The plan catches up if you're behind. Change them under Savings goals.
        </Text>
      ) : onDebts ? (
        <Text style={[type.caption, { color: t.text3, padding: space.sm }]}>
          These come from your debts, so they're counted once. Change them on the Debts page.
          {payrollLoans.length ? " 401(k) loan repayments aren't listed: they come out of your paycheck, before take-home." : ""}
        </Text>
      ) : current ? <Button title={`Add item to ${current.name}`} icon="plus" tone="ghost" onPress={() => addItem(current.name)} style={{ alignSelf: "flex-start" }} /> : undefined}
    />
  );
}

/**
 * One recurring goal in the Set aside group: this month's amount, and (tap) every month until it's due,
 * straight from the plan, so catch-up months and "already set aside" months show as they are.
 */
function SetAsideRow({
  goal: g, months, start, thisMonth, cols,
}: {
  goal: Goal; months: MonthRow[]; start: Date; thisMonth: string; cols: ReturnType<typeof budgetCols>;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const r = g.recurring!;
  const due = nextDue(r, thisMonth);
  // this month through the due month, then the first month of the next round
  const untilDue = Math.min(monthsBetween(thisMonth, due), 23);
  const schedule = months.slice(0, untilDue + 2).map((m, k) => ({ k, amount: m.setAsideBy[g.id] ?? 0, isDue: k === untilDue }));
  const now = schedule[0]?.amount ?? setAsideFor(g, thisMonth);
  const next = schedule[1]?.amount;
  const paidNow = !!r.paidThrough && r.paidThrough >= thisMonth;
  return (
    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }}>
      <Pressable
        role="button"
        aria-expanded={open}
        accessibilityLabel={`${g.name || "Goal"}: ${money(now)} this month. Show each month`}
        onPress={() => setOpen((o) => !o)}
        style={[styles.row, { borderBottomWidth: 0 }]}
      >
        <View style={{ flex: 1, minWidth: 0, paddingVertical: 4 }}>
          <Text numberOfLines={2} style={[type.body, { color: t.text }]}>{g.name || "Goal"}</Text>
          <Text style={[type.caption, { color: t.text3 }]}>
            {money(g.target)} {everyLabel(r.every)} · due {dueLabel(due)}
            {paidNow ? " · already set aside this month" : ""}
            {next !== undefined ? ` · next month ${money(next)}` : ""}
          </Text>
        </View>
        <Text style={[type.body, { width: cols.amount, textAlign: "right", color: t.text, fontVariant: ["tabular-nums"] }]}>{money(now)}</Text>
        <View style={[styles.actions, { width: cols.actions }]}>
          <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
            <Icon name="chevron" size={16} color={t.text3} />
          </View>
        </View>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: 2 }}>
          <Text style={[type.overline, { color: t.text3, marginBottom: 2 }]}>Each month</Text>
          {schedule.map((x) => (
            <View key={x.k} style={styles.schedRow}>
              <Text style={[type.caption, { color: x.k === 0 ? t.text : t.text2, flex: 1, fontWeight: x.k === 0 ? "700" : "400" }]}>
                {x.k === 0 ? `This month (${monthLabel(start, 0)})` : monthLabel(start, x.k)}
                {x.isDue ? " · due, spent this month" : ""}
              </Text>
              <Text style={[type.caption, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(x.amount)}</Text>
            </View>
          ))}
          <Text style={[type.caption, { color: t.text3, marginTop: 4 }]}>
            Each month sets aside what's still needed ÷ months left, so it evens out if you start late or save extra. After it's spent, it starts again.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Hints for the items in a group: a better group, or "this is something you save up for". */
function Suggestions({
  items, notice, onDismissNotice, onMove, onGoal, onDismiss,
}: {
  items: BudgetItem[];
  notice: string | null;
  onDismissNotice: () => void;
  onMove: (id: string, group: string) => void;
  onGoal: (id: string, recurring: boolean, december: boolean) => void;
  onDismiss: (id: string) => void;
}) {
  const t = useTheme();
  const list = items.map(suggestFor).filter((x): x is Suggestion => !!x).slice(0, 3);
  if (!list.length && !notice) return null;
  return (
    <View style={{ gap: space.xs, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xs }}>
      {notice ? (
        <View style={[styles.hint, { backgroundColor: t.goodSoft }]}>
          <Text style={[type.caption, { color: t.text, flex: 1 }]}>{notice}</Text>
          <IconButton icon="check" label="OK" onPress={onDismissNotice} />
        </View>
      ) : null}
      {list.map((sg) => {
        const name = sg.item.name.trim();
        return (
          <View key={sg.item.id} style={[styles.hint, { backgroundColor: t.accentSoft }]}>
            <Icon name="sparkle" size={16} color={t.accent} />
            <Text style={[type.caption, { color: t.text, flex: 1 }]}>
              {sg.kind === "group"
                ? `"${name}" usually goes under ${sg.group}.`
                : sg.recurring
                  ? `"${name}" sounds like something you save up for each year. As a recurring goal it's set aside monthly and ready when due.`
                  : `"${name}" sounds like something you're saving up for. As a goal it gets its own step in your plan.`}
            </Text>
            <Button
              title={sg.kind === "group" ? `Move` : "Make it a goal"}
              tone="primary"
              onPress={() => (sg.kind === "group" ? onMove(sg.item.id, sg.group) : onGoal(sg.item.id, sg.recurring, sg.december))}
              style={{ minHeight: 32, paddingHorizontal: space.md }}
            />
            <IconButton icon="close" label={`Dismiss suggestion for ${name}`} onPress={() => onDismiss(sg.item.id)} />
          </View>
        );
      })}
    </View>
  );
}

/** Group name: read-only with an ✎ button; edit mode shows a field, ✓ (or Enter) to save and the delete button. */
function GroupName({
  name, onRename, onRemove, others, onMerge,
}: {
  name: string; onRename: (to: string) => void; onRemove: () => void;
  /** The other groups, to merge this one into. */
  others: string[];
  onMerge: (into: string) => void;
}) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const save = () => {
    const v = text.trim();
    if (v && v !== name) onRename(v);
    setEditing(false);
  };
  if (!editing) {
    return (
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 2 }}>
        <Text numberOfLines={1} role="heading" aria-level={2} style={[type.heading, { color: t.text, flexShrink: 1 }]}>{name}</Text>
        <IconButton icon="edit" label={`Rename ${name}`} onPress={() => { setText(name); setEditing(true); }} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, minWidth: 0, gap: space.sm }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <TextInput
          autoFocus
          accessibilityLabel="Group name"
          value={text}
          onChangeText={setText}
          onSubmitEditing={save}
          {...(Platform.OS === "web" ? ({ onKeyDown: (e: { key: string }) => { if (e.key === "Escape") setEditing(false); } } as object) : {})}
          style={[
            type.heading,
            { color: t.text, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: t.accent, backgroundColor: t.surface2 },
            Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
          ]}
        />
      </View>
      <IconButton icon="check" color={t.accent} label="Save group name" onPress={save} />
      <IconButton icon="trash" color={t.bad} label={`Remove group ${name}`} onPress={() => { setEditing(false); onRemove(); }} />
    </View>
    {others.length ? (
      <View style={{ gap: 6 }}>
        <Text style={[type.caption, { color: t.text3 }]}>Or merge it into another group (its items move there):</Text>
        <View style={styles.chips}>
          {others.map((g) => (
            <Pressable
              key={g}
              role="button"
              accessibilityLabel={`Merge ${name} into ${g}`}
              onPress={() => { setEditing(false); onMerge(g); }}
              style={[styles.chip, { borderColor: t.border, backgroundColor: t.surface }]}
            >
              <Text style={[type.caption, { color: t.text, fontWeight: "600" }]}>{g}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    ) : null}
    </View>
  );
}

const NEW_GROUP = "\u0000new";

/** "Move to" chips for an item: every other group, plus a new one. */
function MoveTo({ current, groups, what, onPick }: { current: string; groups: string[]; what: string; onPick: (group: string) => void }) {
  const t = useTheme();
  const others = groups.filter((g) => g !== current);
  return (
    <View style={{ gap: 6, paddingTop: space.xs }}>
      <Text style={[type.caption, { color: t.text3 }]}>Move to</Text>
      <View style={styles.chips}>
        {others.map((g) => (
          <Pressable key={g} role="button" accessibilityLabel={`Move ${what} to ${g}`} onPress={() => onPick(g)} style={[styles.chip, { borderColor: t.border, backgroundColor: t.surface }]}>
            <Text style={[type.caption, { color: t.text, fontWeight: "600" }]}>{g}</Text>
          </Pressable>
        ))}
        <Pressable role="button" accessibilityLabel={`Move ${what} to a new group`} onPress={() => onPick(NEW_GROUP)} style={[styles.chip, { borderColor: t.border, borderStyle: "dashed" }]}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>+ New group</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Column widths: roomy on wide screens, tight on phones so item names stay visible. */
export const budgetCols = (compact: boolean) =>
  compact ? { amount: 84, retire: 0, actions: 40 } : { amount: 124, retire: 120, actions: 84 };

/** One budget item: read-only text by default; ✎ turns it into inputs, ✓ finishes. */
function BudgetRow({
  item, group, editing, compact, onEdit, onDone, onChange, onRemove, reorder, groups, onMoveTo,
}: {
  item: BudgetItem; group: string; editing: boolean; compact: boolean;
  /** All group names, and moving this item to one of them (or a new group). */
  groups: string[];
  onMoveTo: (group: string) => void;
  /** Reorder mode: up/down arrows instead of the edit button. */
  reorder?: { up: boolean; down: boolean; move: (by: -1 | 1) => void };
  onEdit: () => void; onDone: () => void; onChange: (patch: Partial<BudgetItem>) => void; onRemove: () => void;
}) {
  const t = useTheme();
  const name = item.name || "Untitled item";
  const w = { ...budgetCols(compact), ...(reorder ? { actions: 84 } : null) };
  const nameField = (
    <View style={{ flex: 1, minWidth: 0 }}>
      <TextField label={`Item in ${group}`} placeholder="Item name" value={item.name} onChange={(v) => onChange({ name: v })} />
    </View>
  );
  const done = <IconButton icon="check" color={t.accent} label={`Done editing ${name}`} onPress={onDone} />;
  const del = <IconButton icon="trash" color={t.bad} label={`Remove ${name}`} onPress={onRemove} />;
  const toggle = <Toggle label={`Still pay ${name} after you retire`} value={item.inRetirement} onChange={(v) => onChange({ inRetirement: v })} />;
  const moveTo = <MoveTo current={group} groups={groups} what={name} onPick={onMoveTo} />;

  if (editing && compact) {
    // phones: name on its own line, then amount + retirement switch
    return (
      <View style={[styles.row, { flexDirection: "column", alignItems: "stretch", gap: space.sm, paddingVertical: space.md, borderBottomColor: t.border, backgroundColor: t.accentSoft }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          {nameField}
          {done}
          {del}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <NumberInput kind="money" width={150} label={`${name} per month`} value={item.amount} onChange={(v) => onChange({ amount: v })} />
          {toggle}
          <Text style={[type.caption, { color: t.text2, flex: 1 }]}>{item.inRetirement ? "Still pay after I retire" : "Stops when I retire"}</Text>
        </View>
        {moveTo}
      </View>
    );
  }
  if (editing) {
    // wide screens: the inputs on one line, "Move to" underneath
    return (
      <View style={{ backgroundColor: t.accentSoft, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, paddingBottom: space.sm }}>
        <View style={[styles.row, { borderBottomWidth: 0 }]}>
          {nameField}
          <NumberInput kind="money" width={w.amount} label={`${name} per month`} value={item.amount} onChange={(v) => onChange({ amount: v })} />
          <View style={{ width: w.retire, alignItems: "center" }}>{toggle}</View>
          <View style={[styles.actions, { width: w.actions }]}>
            {done}
            {del}
          </View>
        </View>
        <View style={{ paddingHorizontal: space.lg }}>{moveTo}</View>
      </View>
    );
  }
  return (
    <View style={[styles.row, { borderBottomColor: t.border, backgroundColor: editing ? t.accentSoft : "transparent" }]}>
      {editing ? (
        <>
          {nameField}
          <NumberInput kind="money" width={w.amount} label={`${name} per month`} value={item.amount} onChange={(v) => onChange({ amount: v })} />
          <View style={{ width: w.retire, alignItems: "center" }}>{toggle}</View>
          <View style={[styles.actions, { width: w.actions }]}>
            {done}
            {del}
          </View>
        </>
      ) : (
        <>
          {compact ? (
            // phones: the retirement status goes under the name so the name gets the room
            <View style={{ flex: 1, minWidth: 0, paddingVertical: 4 }}>
              <Text numberOfLines={2} style={[type.body, { color: item.name ? t.text : t.text3 }]}>{name}</Text>
              <Text style={[type.caption, { color: item.inRetirement ? t.good : t.text3 }]}>{item.inRetirement ? "Still pay after I retire" : "Stops when I retire"}</Text>
            </View>
          ) : (
            <Text numberOfLines={1} style={[type.body, { flex: 1, minWidth: 0, color: item.name ? t.text : t.text3 }]}>{name}</Text>
          )}
          <Text style={[type.body, { width: w.amount, textAlign: "right", color: t.text, fontVariant: ["tabular-nums"] }]}>{money(item.amount)}</Text>
          {compact ? null : (
            <View style={{ width: w.retire, alignItems: "center" }}>
              <View style={{ alignSelf: "center" }}>
                <Pill tone={item.inRetirement ? "good" : "neutral"}>{item.inRetirement ? "Still pay" : "Stops"}</Pill>
              </View>
            </View>
          )}
          <View style={[styles.actions, { width: w.actions }]}>
            {reorder ? (
              <>
                <IconButton icon="up" label={`Move ${name} up`} disabled={!reorder.up} onPress={() => reorder.move(-1)} />
                <IconButton icon="down" label={`Move ${name} down`} disabled={!reorder.down} onPress={() => reorder.move(1)} />
              </>
            ) : (
              <IconButton icon="edit" label={`Edit ${name}`} onPress={onEdit} />
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  flow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.lg },
  figure: { flexDirection: "row", alignItems: "center" },
  result: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, marginLeft: "auto" },
  debtNote: { borderRadius: radius.sm, padding: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
  reorderBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  schedRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 3 },
  hint: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.sm, paddingVertical: space.xs, paddingLeft: space.md, paddingRight: space.xs, flexWrap: "wrap" },
  reorderBar: { flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.lg, marginBottom: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.sm },
  moveBtn: { minHeight: 34, paddingHorizontal: space.md },
  tip: { width: "100%", padding: space.md, borderRadius: radius.sm, overflow: "hidden" },
  headRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm },
  cols: { flexDirection: "row", alignItems: "center", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 6, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center" },
});
