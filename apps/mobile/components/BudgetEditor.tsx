import type { BudgetItem } from "@coastfi/engine";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { confirm } from "../lib/confirm";
import { debtLabel } from "../lib/debts";
import { paycheckFor } from "../lib/loans";
import { money } from "../lib/format";
import { HELP } from "../lib/help";
import { useLayout } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, InfoTip, NumberInput, TextField, Toggle } from "./form";
import { Icon } from "./Icon";
import { AddChip, MasterDetail, useFillPage, useTwoPane } from "./MasterDetail";
import { Card, Pill } from "./ui";

const UNGROUPED = "Other";
/** Key of the read-only "Debt payments" group (not a real budget group). */
const DEBT_KEY = "\u0000debts";
const groupOf = (b: BudgetItem) => b.group?.trim() || UNGROUPED;

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
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  // compact rows when the items pane itself is narrow (phones, or two panes on a mid-size window)
  const { contentWidth } = useLayout();
  const twoPane = useTwoPane();
  const fillPage = useFillPage();
  const [showDetails, setShowDetails] = useState(false);
  const paneWidth = twoPane ? contentWidth - 270 - space.md : contentWidth;
  const compact = paneWidth < 560;
  const cols = budgetCols(compact);
  const groups = grouped(state.budget);
  const [selected, setSelected] = useState<string | undefined>(groups[0]?.name);
  const [retireTip, setRetireTip] = useState(false);
  const names = groups.map((g) => g.name).join("|");
  // debt payments come from Debts: shown here as a read-only group so the budget lists everything
  const debtRows = state.debts.filter((x) => x.balance > 0 && x.minPayment > 0);
  const onDebts = selected === DEBT_KEY && debtRows.length > 0;
  useEffect(() => {
    if (selected === DEBT_KEY && debtRows.length > 0) return;
    if (!selected || !groups.some((g) => g.name === selected)) setSelected(groups[0]?.name);
  }, [names, debtRows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = onDebts ? undefined : groups.find((g) => g.name === selected) ?? groups[0];
  const retireMonthly = state.budget.filter((b) => b.inRetirement).reduce((a, b) => a + b.amount, 0);

  const addGroup = () => {
    const existing = new Set(groups.map((g) => g.name));
    let name = "New group";
    for (let n = 2; existing.has(name); n++) name = `New group ${n}`;
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
  };
  const removeGroup = async (group: string, count: number) => {
    if (await confirm(`Remove "${group}"?`, `This removes the group and its ${count} item${count === 1 ? "" : "s"}.`, "Remove"))
      update((p) => { p.budget = p.budget.filter((b) => groupOf(b) !== group); });
  };

  // what's left each month once the budget and debt minimums are paid (engine numbers, normal month)
  const d = result.d;
  const leftover = d.leanMonthly - d.budgetTotal - d.debtMins;
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
          <Text style={[type.label, { color: t.text2 }]}>{leftover < 0 ? "Short each month" : "Left over to save"}</Text>
          <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]} numberOfLines={2}>
            {money(d.leanMonthly)} take-home − {money(d.budgetTotal)} budget{d.debtMins > 0 ? ` − ${money(d.debtMins)} debts` : ""}
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
              : "Your plan puts the leftover to work: emergency fund, employer match, debt, then investing (see the Plan tab)."}
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
        <View style={[styles.figure, styles.result, { backgroundColor: leftover < 0 ? t.badSoft : t.goodSoft }]}>
          <Text style={[type.heading, { color: t.text3, marginRight: space.sm }]}>=</Text>
          <View>
            <Text style={[type.caption, { color: t.text2 }]}>{leftover < 0 ? "Short each month" : "Left over to save"}</Text>
            <Text style={[type.stat, { color: leftover < 0 ? t.bad : t.good, fontVariant: ["tabular-nums"] }]}>{money(leftover)}/mo</Text>
          </View>
        </View>
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>
        {leftover < 0
          ? "Your budget is more than you bring home in a normal month. Coasting only works once today's bills are covered."
          : "Your plan puts the leftover to work: emergency fund, employer match, debt, then investing (see the Plan tab)."}
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
      ]}
      selected={onDebts ? DEBT_KEY : current?.name}
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
        onDebts ? (
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
              <GroupName key={current.name} name={current.name} onRename={(to) => renameGroup(current.name, to)} onRemove={() => removeGroup(current.name, current.rows.length)} />
              <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(current.subtotal)}/mo</Text>
            </View>
            <View style={[styles.cols, { paddingHorizontal: space.lg, paddingBottom: space.sm }]}>
              <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Item</Text>
              <Text style={[type.overline, { color: t.text3, width: cols.amount, textAlign: "right" }]}>Monthly</Text>
              {compact ? null : (
                <View style={{ width: cols.retire, alignItems: "center" }}>
                  <Text style={[type.overline, { color: t.text3, textAlign: "center", fontWeight: "600" }]}>After you retire?</Text>
                </View>
              )}
              <View style={{ width: cols.actions }} />
            </View>
          </View>
        ) : undefined
      }
      detail={
        onDebts
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
          ? current.rows.map(({ item, index }) => (
              <BudgetRow
                key={item.id}
                item={item}
                group={current.name}
                editing={editing === item.id}
                compact={compact}
                onEdit={() => setEditing(item.id)}
                onDone={() => setEditing(null)}
                onChange={(patch) => update((p) => { p.budget[index] = { ...p.budget[index]!, ...patch }; })}
                onRemove={() => { setEditing(null); update((p) => { p.budget.splice(index, 1); }); }}
              />
            ))
          : null
      }
      detailFooter={onDebts ? (
        <Text style={[type.caption, { color: t.text3, padding: space.sm }]}>
          These come from your debts, so they're counted once. Change them on the Debts page (or under Income for a paycheck 401(k) loan).
        </Text>
      ) : current ? <Button title={`Add item to ${current.name}`} icon="plus" tone="ghost" onPress={() => addItem(current.name)} style={{ alignSelf: "flex-start" }} /> : undefined}
    />
  );
}

/** Group name: read-only with an ✎ button; edit mode shows a field, ✓ (or Enter) to save and the delete button. */
function GroupName({ name, onRename, onRemove }: { name: string; onRename: (to: string) => void; onRemove: () => void }) {
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
    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.xs }}>
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
  );
}

/** Column widths: roomy on wide screens, tight on phones so item names stay visible. */
export const budgetCols = (compact: boolean) =>
  compact ? { amount: 84, retire: 0, actions: 40 } : { amount: 124, retire: 120, actions: 84 };

/** One budget item: read-only text by default; ✎ turns it into inputs, ✓ finishes. */
function BudgetRow({
  item, group, editing, compact, onEdit, onDone, onChange, onRemove,
}: {
  item: BudgetItem; group: string; editing: boolean; compact: boolean;
  onEdit: () => void; onDone: () => void; onChange: (patch: Partial<BudgetItem>) => void; onRemove: () => void;
}) {
  const t = useTheme();
  const name = item.name || "Untitled item";
  const w = budgetCols(compact);
  const nameField = (
    <View style={{ flex: 1, minWidth: 0 }}>
      <TextField label={`Item in ${group}`} placeholder="Item name" value={item.name} onChange={(v) => onChange({ name: v })} />
    </View>
  );
  const done = <IconButton icon="check" color={t.accent} label={`Done editing ${name}`} onPress={onDone} />;
  const del = <IconButton icon="trash" color={t.bad} label={`Remove ${name}`} onPress={onRemove} />;
  const toggle = <Toggle label={`Still pay ${name} after you retire`} value={item.inRetirement} onChange={(v) => onChange({ inRetirement: v })} />;

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
            <IconButton icon="edit" label={`Edit ${name}`} onPress={onEdit} />
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
  tip: { width: "100%", padding: space.md, borderRadius: radius.sm, overflow: "hidden" },
  headRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm },
  cols: { flexDirection: "row", alignItems: "center", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 6, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center" },
});
