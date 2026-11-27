/**
 * Retirement spending: what you'll spend a month once you retire, and where it comes from.
 * - The total: the categories you'll still pay, home taxes and insurance, healthcare, plus what your number
 *   sets aside for costs that end (mortgage payments left, health insurance until Medicare).
 * - Each category on two lines: whether you'd still pay it, then where its amount comes from: its plan
 *   amount (what you budget), what you've spent on it a month over the last 12 months, or your own.
 * - A category that pays a loan is locked: Debts counts the loan.
 * Whether a category is essential is on Emergency mode (it isn't only about retirement).
 */
import type { BudgetItem } from "@coastfi/engine";
import { StyleSheet, Text, View } from "react-native";
import { Chip, FieldRow, InlineMoney, InlineSwitch, NumberInput, Segmented, Select } from "./form";
import { Icon } from "./Icon";
import { debtItPays } from "../lib/debtLink";
import { debtLabel } from "../lib/debts";
import { Card, Divider } from "./ui";
import { groupOf, groupOrder } from "../lib/budgetOrder";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";

type Source = "plan" | "avg" | "own";

export function RetirementEssentials() {
  const t = useTheme();
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  const d = result.d;
  // investing categories (money moved into an account) aren't spending, so they aren't here
  const items = state.budget.filter((b) => !b.accountId && !b.hidden);
  const edit = (id: string, fn: (it: BudgetItem) => void) =>
    update((p) => {
      const it = p.budget.find((x) => x.id === id);
      if (it) fn(it);
    });
  // what you've spent lately (12 months), when there's anything to average
  const avgOn = !!state.spentAvg?.months;
  const avgOf = (b: BudgetItem) => state.spentAvg?.by[b.id] ?? 0;
  const sourceOf = (b: BudgetItem): Source => (b.retireAmount !== undefined ? "own" : b.retireFrom === "avg" && avgOn ? "avg" : "plan");
  // what it counts in retirement (the engine's number), and the same for one you won't pay then
  const amountOf = (b: BudgetItem) => d.retireItems[b.id] ?? b.amount;
  const choose = (b: BudgetItem, v: Source) =>
    edit(b.id, (it) => {
      if (v === "own") {
        it.retireAmount = Math.round(amountOf(b) * 100) / 100;
        return;
      }
      delete it.retireAmount;
      if (v === "avg") it.retireFrom = "avg";
      else delete it.retireFrom;
    });
  const setAll = (v: "plan" | "avg") =>
    update((p) => {
      for (const it of p.budget) {
        if (it.accountId || it.hidden || it.paysDebt || it.retireAmount !== undefined) continue;
        if (v === "avg") it.retireFrom = "avg";
        else delete it.retireFrom;
      }
    });
  const groups = groupOrder(items);

  const fixed = d.retireSpendingSet;
  const budgetYearly = d.retireMonthlyBudget * 12;
  const target = state.retireSpending ?? 0;
  const gap = budgetYearly - target;
  const categories = Object.values(d.retireItems).reduce((a, v) => a + v, 0);
  const homeBridge = result.homeBridge;
  const owedAtRetire = result.mortgagesAtRetire;

  const line = (label: string, value: number, note?: string, bold?: boolean) => (
    <View style={styles.line}>
      <Text style={[type.body, { color: t.text, flex: 1, fontWeight: bold ? "700" : "400" }]}>
        {label}
        {note ? <Text style={[type.caption, { color: t.text3 }]}> {note}</Text> : null}
      </Text>
      <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"], fontWeight: bold ? "700" : "400" }]}>{money(value, { whole: true })}</Text>
    </View>
  );

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

      {/* the total: what you'll spend a month, and what your number sets aside for costs that end */}
      <Card style={{ gap: 2 }}>
        <Text style={[type.caption, { color: t.text3 }]}>{fixed ? "From your budget, for comparison" : "Your spending in retirement"}</Text>
        <Text style={[type.title, { color: t.text, fontVariant: ["tabular-nums"] }]}>
          {money(d.retireMonthlyBudget, { whole: true })}
          <Text style={[type.caption, { color: t.text3 }]}>/mo</Text>
        </Text>
        {line("Categories you'll still pay", categories)}
        {d.setAsideRetired > 0.5 ? line("Bills you set aside for", d.setAsideRetired) : null}
        {d.escrowMonthly > 0.5 ? line("Home taxes & insurance", d.escrowMonthly, "keep going") : null}
        {d.homeMonthly > 0.5 ? line("Home costs & upkeep", d.homeMonthly) : null}
        {d.healthRetired > 0.5 ? line("Healthcare", d.healthRetired, state.medicare !== undefined && state.retireAge < 65 ? "Medicare from 65" : undefined) : null}
        <View style={[styles.sum, { borderTopColor: t.border }]}>{line("Total", d.retireMonthlyBudget, undefined, true)}</View>
        {homeBridge > 0.5 || d.healthBridge > 0.5 ? (
          <>
            <Text style={[type.caption, { color: t.text3, marginTop: space.sm }]}>Plus, in your number for costs that end:</Text>
            {homeBridge > 0.5 ? line("Mortgage payments left", homeBridge, `after you retire, interest included`) : null}
            {d.healthBridge > 0.5 ? line("Health insurance until 65", d.healthBridge, "beyond Medicare's cost") : null}
          </>
        ) : null}
        <Text style={[type.caption, { color: t.text3, marginTop: space.sm }]}>
          {fixed
            ? "Your set amount drives your retirement number instead."
            : `This sets your retirement number (${money(result.fire, { whole: true })}). Social Security and pensions come off it.`}
        </Text>
      </Card>

      <Card style={{ gap: 2 }}>
        <Text style={[type.caption, { color: t.text3 }]}>
          Each category: its plan amount (what you budget), what you've spent on it a month over the last 12 months, or your own.
        </Text>
        {avgOn ? (
          <Text style={[type.caption, { color: t.text3 }]}>
            Set all to{" "}
            <Text role="button" onPress={() => setAll("plan")} style={{ color: t.accent, fontWeight: "700" }}>Plan</Text>
            {" · "}
            <Text role="button" onPress={() => setAll("avg")} style={{ color: t.accent, fontWeight: "700" }}>Avg</Text>
            <Text> (your own amounts stay)</Text>
          </Text>
        ) : (
          <Text style={[type.caption, { color: t.text3 }]}>No transactions yet to average: Avg shows up once you have some.</Text>
        )}
        {groups.map((g, gi) => {
          const list = items.filter((b) => groupOf(b) === g);
          const sum = list.filter((b) => b.inRetirement && !b.paysDebt).reduce((a, b) => a + amountOf(b), 0);
          return (
            <View key={g} style={{ gap: 2 }}>
              {gi > 0 ? <Divider /> : null}
              <View style={[styles.row, { marginTop: space.sm }]}>
                <Text style={[type.overline, { color: t.text2, flex: 1 }]}>{g}</Text>
                <Text style={[type.caption, { color: t.text3 }]}>{money(sum, { whole: true })}/mo</Text>
              </View>
              {list.map((b, i) => {
                const name = b.name || "Category";
                const linked = b.paysDebt ? state.debts.find((x) => x.id === b.paysDebt) : undefined;
                const loan = linked ? undefined : debtItPays(state, b);
                const what = (x: { kind?: string }) => (x.kind === "mortgage" ? "mortgage" : "loan");
                const sep = i > 0 ? <Divider /> : null;
                // a category that pays a loan: locked, Debts counts the loan (and what's left after you retire)
                if (linked) {
                  const left = owedAtRetire.find((x) => x.id === linked.id);
                  const escrow = linked.kind === "mortgage" ? Math.min(Math.max(0, linked.escrow ?? 0), linked.minPayment) : 0;
                  const note = left
                    ? left.months !== null
                      ? `${left.months} payment${left.months === 1 ? "" : "s"} left after you retire, about ${money(left.total, { whole: true })} with interest, in your number.`
                      : `${money(left.balance, { whole: true })} still owed when you retire, in your number.`
                    : linked.kind === "mortgage" && linked.balance > 0
                      ? "Paid off before you retire."
                      : "Counted from Debts until it's paid off.";
                  return (
                    <View key={b.id}>
                      {sep}
                      <View style={styles.item}>
                        <View style={styles.row}>
                          <Text style={[type.body, { color: t.text, fontWeight: "600", flex: 1 }]} numberOfLines={1}>{name}</Text>
                          <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(escrow, { whole: true })}<Text style={[type.caption, { color: t.text3 }]}>/mo</Text></Text>
                        </View>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          <View style={{ paddingTop: 2 }}><Icon name="lock" size={12} color={t.text3} /></View>
                          <Text style={[type.caption, { color: t.text3, flex: 1 }]}>
                            Pays your {debtLabel(linked)} {what(linked)}, from Debts. {note}
                            {escrow > 0.5 ? ` Its taxes & insurance (${money(escrow, { whole: true })}/mo) keep going.` : ""}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                }
                const src = sourceOf(b);
                const alt = [src !== "plan" ? `plan ${money(b.amount, { whole: true })}` : "", src !== "avg" && avgOn ? `avg ${money(avgOf(b), { whole: true })}` : ""].filter(Boolean).join(" · ");
                return (
                  <View key={b.id}>
                    {sep}
                    <View style={styles.item}>
                      <View style={styles.row}>
                        <Text style={[type.body, { color: b.inRetirement ? t.text : t.text3, fontWeight: "600", flex: 1 }]} numberOfLines={1}>{name}</Text>
                        <InlineSwitch label={`${name}: still paid after you retire`} value={b.inRetirement} onChange={(v) => edit(b.id, (it) => { it.inRetirement = v; })} />
                      </View>
                      {b.inRetirement ? (
                        <>
                          <View style={styles.row}>
                            <Segmented
                              label={`${name}: amount in retirement from`}
                              value={src}
                              options={[{ value: "plan" as const, label: "Plan" }, ...(avgOn ? [{ value: "avg" as const, label: "Avg" }] : []), { value: "own" as const, label: "Own" }]}
                              onChange={(v) => choose(b, v)}
                            />
                            <View style={{ flex: 1 }} />
                            {src === "own" ? (
                              <InlineMoney compact label={`${name}: a month in retirement`} value={b.retireAmount ?? 0} onChange={(v) => edit(b.id, (it) => { it.retireAmount = v; })} />
                            ) : (
                              <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"], fontWeight: "600" }]}>{money(amountOf(b), { whole: true })}</Text>
                            )}
                          </View>
                          {alt ? <Text style={[type.caption, { color: t.text3, textAlign: "right" }]}>{alt}</Text> : null}
                        </>
                      ) : (
                        <Text style={[type.caption, { color: t.text3 }]}>Not paid after you retire · {money(b.amount, { whole: true })}/mo now</Text>
                      )}
                    </View>
                    {loan ? (
                      <View style={[styles.loanBox, { backgroundColor: t.warnSoft }]}>
                        <Text style={[type.caption, { color: t.text }]}>
                          Pays your {debtLabel(loan)} {what(loan)}? Its payment is already in your plan from Debts, so right now it's counted twice.
                        </Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                          <Chip title="Yes, link it" tone="accent" icon="check" onPress={() => edit(b.id, (it) => { it.paysDebt = loan.id; })} />
                          <Chip title="It's something else" icon="close" onPress={() => edit(b.id, (it) => { it.noSuggest = true; })} />
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
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  item: { gap: 6, paddingVertical: space.sm },
  line: { flexDirection: "row", alignItems: "baseline", gap: space.sm, paddingVertical: 3 },
  sum: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.xs, paddingTop: space.xs },
  loanBox: { gap: 6, borderRadius: 10, padding: space.sm, marginBottom: space.xs },
});
