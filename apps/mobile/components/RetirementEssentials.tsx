/**
 * Retirement spending: for every spending category, whether you'd still pay it after you retire, and
 * what it would cost then (that's what builds your retirement number). Whether it's essential is on
 * Emergency mode (it isn't only about retirement).
 */
import { StyleSheet, Text, View } from "react-native";
import { Chip, FieldRow, InlineMoney, InlineSwitch, NumberInput, Select } from "./form";
import { debtItPays } from "../lib/debtLink";
import { debtLabel } from "../lib/debts";
import { Card, Divider } from "./ui";
import { groupOf, groupOrder } from "../lib/budgetOrder";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";

export function RetirementEssentials() {
  const t = useTheme();
  const { state, result, start } = usePlan();
  const update = useStore((s) => s.update);
  const d = result.d;
  // investing categories (money moved into an account) aren't spending, so they aren't here
  const items = state.budget.filter((b) => !b.accountId && !b.hidden);
  const set = (id: string, patch: { inRetirement?: boolean; retireAmount?: number; paysDebt?: string; noSuggest?: boolean }) =>
    update((p) => {
      const it = p.budget.find((x) => x.id === id);
      if (it) Object.assign(it, patch);
    });
  // what each costs in retirement: its own amount, else (by your choice) its plan amount or this month's assigned
  const fromAssigned = state.retireAmountsFrom === "assigned";
  const assignedNow = state.budgetPlan?.months?.[`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`]?.assigned ?? {};
  const usual = (b: (typeof items)[number]) => (fromAssigned ? Math.max(0, assignedNow[b.id] ?? 0) : b.amount);
  const retireOf = (b: (typeof items)[number]) => (b.retireAmount !== undefined ? b.retireAmount : usual(b));
  const clearOwn = (id: string) => update((p) => { const it = p.budget.find((x) => x.id === id); if (it) delete it.retireAmount; });
  const setOwn = (b: (typeof items)[number], v: number) => update((p) => { const it = p.budget.find((x) => x.id === b.id); if (!it) return; if (Math.abs(v - usual(b)) < 0.005) delete it.retireAmount; else it.retireAmount = v; });
  const afterRetiring = items.filter((b) => b.inRetirement && !b.paysDebt).reduce((a, b) => a + retireOf(b), 0);
  const groups = groupOrder(items);

  const fixed = d.retireSpendingSet;
  const budgetYearly = d.retireMonthlyBudget * 12;
  const target = state.retireSpending ?? 0;
  const gap = budgetYearly - target;

  return (
    <>
      <Card style={{ gap: space.sm }}>
        <FieldRow
          label="Spending"
          info="Work it out from your budget (the categories you'd still pay, plus healthcare and home costs), or type the yearly amount you plan to spend, like $100,000. A set amount covers everything, healthcare from 65 included. Social Security and pensions still come off it."
        >
          <Select
            label="Retirement spending"
            value={fixed ? "set" : "budget"}
            options={[{ value: "budget", label: "From my budget" }, { value: "set", label: "A set amount" }]}
            onChange={(v) =>
              update((p) => {
                // start the set amount from what the budget adds up to, rounded to $1,000
                p.retireSpending = v === "set" ? Math.max(1000, Math.round(budgetYearly / 1000) * 1000) : undefined;
              })
            }
          />
        </FieldRow>
        {fixed ? (
          <>
            <FieldRow label="Yearly amount" hint="Today's dollars, everything you'll spend in a year">
              <NumberInput kind="money" label="Yearly retirement spending" value={target} onChange={(v) => update((p) => { p.retireSpending = v > 0 ? v : undefined; })} />
            </FieldRow>
            <Text style={[type.caption, { color: Math.abs(gap) < 500 ? t.text3 : t.text2 }]}>
              Your budget's retirement items add up to {money(budgetYearly, { whole: true })}/yr
              {Math.abs(gap) < 500
                ? ", about the same as your set amount."
                : gap > 0
                  ? `, ${money(gap, { whole: true })} more than your set amount. Your plan uses the set amount.`
                  : `, ${money(-gap, { whole: true })} less than your set amount. Your plan uses the set amount.`}
            </Text>
          </>
        ) : null}
      </Card>
      <Card style={{ gap: space.sm }}>
        <Text style={[type.body, { color: t.text2 }]}>
          For each category: would you still pay it after you retire, and what would it cost then?
        </Text>
        <FieldRow label="Amounts from" info="What a category costs in retirement unless you type its own amount: its plan amount (from YNAB, the average you assigned lately), or what you assigned it this month on the Budget.">
          <Select
            label="Retirement amounts from"
            value={fromAssigned ? "assigned" : "plan"}
            options={[{ value: "plan", label: "Plan amounts" }, { value: "assigned", label: "This month's assigned" }]}
            onChange={(v) => update((p) => { if (v === "assigned") p.retireAmountsFrom = "assigned"; else delete p.retireAmountsFrom; })}
          />
        </FieldRow>
        <View style={styles.totals}>
          <View style={[styles.total, { backgroundColor: t.surface2 }]}>
            <Text style={[type.title, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(afterRetiring, { whole: true })}<Text style={[type.caption, { color: t.text3 }]}>/mo</Text></Text>
            <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Still paid after retiring</Text>
            <Text style={[type.caption, { color: t.text3 }]}>
              {fixed
                ? "For comparison only: your set amount drives your retirement number"
                : `Plus healthcare and home costs, this sets your retirement number (${money(result.fire, { whole: true })})`}
            </Text>
          </View>
        </View>
      </Card>

      <Card style={{ gap: 2 }}>
        <View style={styles.row}>
          <Text style={[type.caption, { color: t.text3, flex: 1 }]} />
          <Text style={[type.caption, styles.col, { color: t.text3 }]}>After retiring</Text>
        </View>
        {groups.map((g, gi) => {
          const list = items.filter((b) => groupOf(b) === g);
          const sum = list.filter((b) => b.inRetirement && !b.paysDebt).reduce((a, b) => a + retireOf(b), 0);
          return (
            <View key={g} style={{ gap: 2 }}>
              {gi > 0 ? <Divider /> : null}
              <View style={[styles.row, { marginTop: space.sm }]}>
                <Text style={[type.overline, { color: t.text2, flex: 1 }]}>{g}</Text>
                <Text style={[type.caption, { color: t.text3 }]}>{money(sum, { whole: true })}/mo after retiring</Text>
              </View>
              {list.map((b) => {
                const name = b.name || "Category";
                const linked = b.paysDebt ? state.debts.find((x) => x.id === b.paysDebt) : undefined;
                const loan = linked ? undefined : debtItPays(state, b);
                const what = (d: { kind?: string }) => (d.kind === "mortgage" ? "mortgage" : "loan");
                // a category that pays a loan: counted from Debts (until it's paid off), so not here
                if (linked)
                  return (
                    <View key={b.id} style={styles.row}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[type.body, { color: t.text3 }]} numberOfLines={1}>{name}</Text>
                        <Text style={[type.caption, { color: t.text3 }]}>
                          Pays your {debtLabel(linked)} {what(linked)}: counted from Debts until it's paid off{linked.kind === "mortgage" ? ", then the home's taxes and insurance" : ""}.
                        </Text>
                      </View>
                    </View>
                  );
                const own = b.retireAmount !== undefined;
                return (
                  <View key={b.id} style={{ gap: 2 }}>
                    <View style={styles.row}>
                      {/* the name on its own line, the amount under it (so the name isn't cut short on a phone) */}
                      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                        <Text style={[type.body, { color: b.inRetirement ? t.text : t.text3 }]} numberOfLines={1}>{name}</Text>
                        {b.inRetirement ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
                            <InlineMoney compact label={`${name}: a month in retirement`} value={retireOf(b)} onChange={(v) => setOwn(b, v)} />
                            {own ? (
                              <Text style={[type.caption, { color: t.text3 }]}>
                                now {money(usual(b), { whole: true })} ·{" "}
                                <Text role="button" onPress={() => clearOwn(b.id)} style={{ color: t.accent, fontWeight: "700" }}>Same</Text>
                              </Text>
                            ) : null}
                          </View>
                        ) : (
                          <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]}>{money(usual(b), { whole: true })}/mo now</Text>
                        )}
                      </View>
                      <View style={styles.col}>
                        <InlineSwitch label={`${name}: still paid after you retire`} value={b.inRetirement} onChange={(v) => set(b.id, { inRetirement: v })} />
                      </View>
                    </View>
                    {loan ? (
                      <View style={[styles.loanBox, { backgroundColor: t.warnSoft }]}>
                        <Text style={[type.caption, { color: t.text }]}>
                          Pays your {debtLabel(loan)} {what(loan)}? Its payment is already in your plan from Debts, so right now it's counted twice.
                        </Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                          <Chip title="Yes, link it" tone="accent" icon="check" onPress={() => set(b.id, { paysDebt: loan.id })} />
                          <Chip title="It's something else" icon="close" onPress={() => set(b.id, { noSuggest: true })} />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })}
        {!items.length ? <Text style={[type.body, { color: t.text3 }]}>No spending categories yet. Add them on the Budget.</Text> : null}
      </Card>
      <Text style={[type.caption, { color: t.text3 }]}>
        Bills set aside each month come from your repeating savings goals, and investing categories (money you put into an account) aren't spending, so neither is listed here.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 4 },
  col: { width: 84, alignItems: "center", textAlign: "center" },
  loanBox: { gap: 6, borderRadius: 10, padding: space.sm, marginBottom: space.xs },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  total: { flexGrow: 1, flexBasis: 200, borderRadius: 10, padding: space.md, gap: 2 },
});
