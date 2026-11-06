import { PERIODS, resolveIncome, type AccountType, type Income, type PayFreq } from "@coastfi/engine";
import { defaultPlanState } from "@coastfi/schema";
import { useState, type ComponentType, type ReactNode } from "react";
import { Platform, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { confirm } from "../../lib/confirm";
import { useLayout } from "../../lib/layout";
import { money, percent } from "../../lib/format";
import { usePlan } from "../../lib/plan";
import { newId, useStore } from "../../lib/store";
import { FORM_MAX_WIDTH, radius, space, type, useTheme } from "../../lib/theme";
import { Button, FieldRow, IconButton, NumberInput, Segmented, TextField, Toggle, ToggleRow } from "../form";
import type { IconName } from "../Icon";
import { Card, Divider } from "../ui";

/* ---------- registry ---------- */

type SectionKey = "profile" | "income" | "budget" | "accounts" | "debts" | "goals" | "assumptions" | "limits" | "data";
type SectionMeta = { key: SectionKey; title: string; subtitle: string; icon: IconName };

export const SECTIONS: { title: string; items: SectionMeta[] }[] = [
  {
    title: "Your money",
    items: [
      { key: "profile", title: "You", subtitle: "Age, retirement age and healthcare", icon: "user" },
      { key: "income", title: "Income", subtitle: "Paychecks, 401(k) and employer match", icon: "wallet" },
      { key: "budget", title: "Monthly budget", subtitle: "What you spend now and in retirement", icon: "card" },
      { key: "accounts", title: "Accounts", subtitle: "Balances you've saved and invested", icon: "database" },
      { key: "debts", title: "Debts", subtitle: "Balances, interest rates and minimums", icon: "card" },
      { key: "goals", title: "Savings goals", subtitle: "Each goal becomes a step in your plan", icon: "target" },
    ],
  },
  {
    title: "How it's calculated",
    items: [
      { key: "assumptions", title: "Assumptions & plan rules", subtitle: "Returns, withdrawal rate, taxes, emergency fund", icon: "sliders" },
      { key: "limits", title: "Contribution limits", subtitle: "401(k), IRA and HSA limits by year", icon: "shield" },
    ],
  },
  { title: "Data", items: [{ key: "data", title: "Backup & restore", subtitle: "Export, import or reset your data", icon: "database" }] },
];

export const findSection = (k?: string) => SECTIONS.flatMap((g) => g.items).find((s) => s.key === k);

/* ---------- shared bits ---------- */

function Group({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {title ? <Text style={[type.overline, { color: t.text3, paddingHorizontal: space.xs }]}>{title}</Text> : null}
      <Card style={{ paddingVertical: space.xs }}>{children}</Card>
      {hint ? <Text style={[type.caption, { color: t.text3, paddingHorizontal: space.xs }]}>{hint}</Text> : null}
    </View>
  );
}

/** Rows separated by hairlines. */
function Rows({ children }: { children: ReactNode[] }) {
  const items = children.filter(Boolean);
  return (
    <>
      {items.map((c, i) => (
        <View key={i}>
          {c}
          {i < items.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </>
  );
}

/** One editable item in a list (an income, a debt…): header with name + delete. */
function ItemCard({ name, onName, onDelete, label, children }: { name: string; onName: (v: string) => void; onDelete: () => void; label: string; children: ReactNode }) {
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField value={name} onChange={onName} label={`${label} name`} />
        </View>
        <IconButton icon="trash" label={`Remove ${name || label}`} onPress={onDelete} />
      </View>
      {children}
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  const t = useTheme();
  return (
    <Card style={{ alignItems: "center", paddingVertical: space.xl }}>
      <Text style={[type.body, { color: t.text3 }]}>{text}</Text>
    </Card>
  );
}

async function removeItem(what: string, name: string, doIt: () => void) {
  if (await confirm(`Remove ${what}?`, `"${name || what}" will be removed from your plan.`, "Remove")) doIt();
}

/* ---------- You ---------- */

function Profile() {
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  return (
    <>
      <Group>
        <Rows>
          {[
            <FieldRow key="age" label="Current age">
              <NumberInput kind="int" label="Current age" value={state.age} min={0} max={100} onChange={(v) => update((p) => { p.age = v; })} />
            </FieldRow>,
            <FieldRow key="ret" label="Target retirement age" hint="When you'd like work to be optional">
              <NumberInput kind="int" label="Target retirement age" value={state.retireAge} min={0} max={100} onChange={(v) => update((p) => { p.retireAge = v; })} />
            </FieldRow>,
          ]}
        </Rows>
      </Group>
      <Group hint="If you'll leave employer coverage before Medicare at 65, budget roughly $500–$1,500+ a month per person.">
        <FieldRow label="Healthcare before Medicare" hint="Per month, in retirement">
          <NumberInput kind="money" label="Healthcare before Medicare per month" value={state.healthcare} min={0} onChange={(v) => update((p) => { p.healthcare = v; })} />
        </FieldRow>
      </Group>
      <Group hint='Used only to compare "your plan" with what you do today.'>
        <FieldRow label="What you invest today" hint="From take-home pay, per month (Roth IRA, brokerage)">
          <NumberInput kind="money" label="What you invest today per month" value={state.currentInvestMonthly} min={0} onChange={(v) => update((p) => { p.currentInvestMonthly = v; })} />
        </FieldRow>
      </Group>
    </>
  );
}

/* ---------- Income ---------- */

const FREQS: { value: PayFreq; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "semimonthly", label: "Twice a month" },
  { value: "monthly", label: "Monthly" },
];

function IncomeSummary({ inc, marginalTax }: { inc: Income; marginalTax: number }) {
  const t = useTheme();
  const r = resolveIncome(inc);
  const P = PERIODS[r.freq];
  const good = r.fullMatch;
  return (
    <View style={[styles.summary, { backgroundColor: good ? t.goodSoft : t.badSoft }]}>
      <Text style={[type.caption, { color: t.text2 }]}>
        You put in <Text style={{ fontWeight: "700", color: t.text }}>{money(r.pretax)}</Text>/check · employer adds{" "}
        <Text style={{ fontWeight: "700", color: t.text }}>{money(r.match)}</Text>/check ({money(r.match * P)}/yr).
      </Text>
      {r.matchMode === "pct" && r.gross ? (
        good ? (
          <Text style={[type.caption, { color: t.good, fontWeight: "600" }]}>✓ You're getting the full match.</Text>
        ) : (
          <Text style={[type.caption, { color: t.bad }]}>
            <Text style={{ fontWeight: "700" }}>Full match needs {percent(r.maxPct ?? 0, 2)}.</Text> Raising from {percent(r.contribPct ?? 0, 2)} adds {money(r.gapPre)}/check
            (about {money(r.gapPre * (1 - marginalTax))} less take-home) for <Text style={{ fontWeight: "700" }}>+{money(r.gapMatch * P)}/yr</Text> of free money.
          </Text>
        )
      ) : !good ? (
        <Text style={[type.caption, { color: t.bad }]}>Not getting the full match. Switch to "% of pay" so the plan can work out the gap.</Text>
      ) : null}
    </View>
  );
}

function IncomeSection() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const set = (i: number, patch: Partial<Income>) => update((p) => { p.incomes[i] = { ...p.incomes[i]!, ...patch }; });

  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Each job or side income gets its own pay schedule. The next payday lets the plan find your 3-paycheck months.
      </Text>
      {state.incomes.length === 0 ? <Empty text="No income yet" /> : null}
      {state.incomes.map((inc, i) => (
        <ItemCard
          key={inc.id}
          label="Income"
          name={inc.name}
          onName={(v) => set(i, { name: v })}
          onDelete={() => removeItem("this income", inc.name, () => update((p) => { p.incomes.splice(i, 1); }))}
        >
          <Segmented label="Pay schedule" options={FREQS} value={inc.freq} onChange={(v) => set(i, { freq: v })} />
          <Rows>
            {[
              <FieldRow key="net" label="Take-home per paycheck" hint="After taxes and deductions">
                <NumberInput kind="money" label="Take-home per paycheck" value={inc.net} min={0} onChange={(v) => set(i, { net: v })} />
              </FieldRow>,
              inc.freq === "weekly" || inc.freq === "biweekly" ? (
                <FieldRow key="pd" label="Next payday" hint="YYYY-MM-DD">
                  <TextField
                    width={140}
                    label="Next payday"
                    placeholder="2026-11-13"
                    value={inc.nextPayday ?? ""}
                    onChange={(v) => set(i, { nextPayday: /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : v === "" ? undefined : inc.nextPayday })}
                  />
                </FieldRow>
              ) : null,
            ]}
          </Rows>

          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
              <Text style={[type.heading, { color: t.text }]}>401(k) & employer match</Text>
              <Segmented
                label="How to enter 401(k)"
                options={[{ value: "pct", label: "% of pay" }, { value: "usd", label: "$ per check" }]}
                value={inc.matchMode}
                onChange={(v) => set(i, { matchMode: v })}
              />
            </View>
            {inc.matchMode === "pct" ? (
              <Rows>
                {[
                  <FieldRow key="g" label="Gross pay per paycheck" hint="Before taxes">
                    <NumberInput kind="money" label="Gross pay per paycheck" value={inc.gross ?? 0} min={0} onChange={(v) => set(i, { gross: v })} />
                  </FieldRow>,
                  <FieldRow key="c" label="You contribute" hint="% of gross pay">
                    <NumberInput kind="percent" label="Your 401(k) percent" value={inc.contribPct ?? 0} min={0} max={1} onChange={(v) => set(i, { contribPct: v })} />
                  </FieldRow>,
                  <FieldRow key="m1" label="Employer matches" hint="Tier 1: match rate, up to % of pay">
                    <View style={styles.pair}>
                      <NumberInput kind="percent" width={92} label="Tier 1 match rate" value={inc.matchRate1 ?? 0} min={0} onChange={(v) => set(i, { matchRate1: v })} />
                      <Text style={[type.caption, { color: t.text3 }]}>of first</Text>
                      <NumberInput kind="percent" width={92} label="Tier 1 up to percent of pay" value={inc.matchUpTo1 ?? 0} min={0} max={1} onChange={(v) => set(i, { matchUpTo1: v })} />
                    </View>
                  </FieldRow>,
                  <FieldRow key="m2" label="Plus" hint="Tier 2 (optional): match rate, of the next % of pay">
                    <View style={styles.pair}>
                      <NumberInput kind="percent" width={92} label="Tier 2 match rate" value={inc.matchRate2 ?? 0} min={0} onChange={(v) => set(i, { matchRate2: v })} />
                      <Text style={[type.caption, { color: t.text3 }]}>of next</Text>
                      <NumberInput kind="percent" width={92} label="Tier 2 percent of pay" value={inc.matchUpTo2 ?? 0} min={0} max={1} onChange={(v) => set(i, { matchUpTo2: v })} />
                    </View>
                  </FieldRow>,
                ]}
              </Rows>
            ) : (
              <Rows>
                {[
                  <FieldRow key="p" label="Your 401(k) per paycheck">
                    <NumberInput kind="money" label="Your 401(k) per paycheck" value={inc.pretax ?? 0} min={0} onChange={(v) => set(i, { pretax: v })} />
                  </FieldRow>,
                  <FieldRow key="m" label="Employer match per paycheck">
                    <NumberInput kind="money" label="Employer match per paycheck" value={inc.match ?? 0} min={0} onChange={(v) => set(i, { match: v })} />
                  </FieldRow>,
                  <ToggleRow key="f" label="Getting the full match" value={inc.fullMatch !== false} onChange={(v) => set(i, { fullMatch: v })} />,
                ]}
              </Rows>
            )}
            <Text style={[type.caption, { color: t.text3 }]}>
              Common formulas: 100% of the first 3% + 50% of the next 2% · 50% of the first 6% · 100% of the first 4%.
            </Text>
            <IncomeSummary inc={inc} marginalTax={state.plan.marginalTax} />
          </View>
        </ItemCard>
      ))}
      <Button
        title="Add income"
        icon="plus"
        onPress={() =>
          update((p) => {
            p.incomes.push({ id: newId(), name: "New income", freq: "biweekly", net: 0, matchMode: "pct", gross: 0, contribPct: 0, matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0, matchUpTo2: 0 });
          })
        }
      />
    </>
  );
}

/* ---------- Budget ---------- */

function BudgetSection() {
  const t = useTheme();
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  const compact = Math.min(useLayout().contentWidth, FORM_MAX_WIDTH) < 560;
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Monthly spending, not including debt payments (those are under Debts). Turn on "In retirement" for anything that continues after you stop working.
      </Text>
      <Card padded={false}>
        {!compact ? (
          <View style={[styles.tableHead, { borderBottomColor: t.border }]}>
            <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Item</Text>
            <Text style={[type.overline, { color: t.text3, width: 130, textAlign: "right" }]}>Per month</Text>
            <Text style={[type.overline, { color: t.text3, width: 108, textAlign: "center" }]}>In retirement</Text>
            <View style={{ width: 40 }} />
          </View>
        ) : null}
        {state.budget.map((b, i) => {
          const name = (
            <View style={{ flex: 1, minWidth: 0 }}>
              <TextField label="Budget item" placeholder="e.g. Groceries" value={b.name} onChange={(v) => update((p) => { p.budget[i]!.name = v; })} />
            </View>
          );
          const amount = <NumberInput kind="money" width={130} label={`${b.name} per month`} value={b.amount} min={0} onChange={(v) => update((p) => { p.budget[i]!.amount = v; })} />;
          const retire = (
            <Toggle label={`${b.name} continues in retirement`} value={b.inRetirement} onChange={(v) => update((p) => { p.budget[i]!.inRetirement = v; })} />
          );
          const del = <IconButton icon="trash" label={`Remove ${b.name}`} onPress={() => update((p) => { p.budget.splice(i, 1); })} />;
          return compact ? (
            <View key={b.id} style={[styles.tableRow, { borderBottomColor: t.border, flexDirection: "column", alignItems: "stretch", gap: space.sm, paddingVertical: space.md }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>{name}{del}</View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                {amount}
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Text style={[type.caption, { color: t.text3 }]}>In retirement</Text>
                  {retire}
                </View>
              </View>
            </View>
          ) : (
            <View key={b.id} style={[styles.tableRow, { borderBottomColor: t.border }]}>
              {name}
              {amount}
              <View style={{ width: 108, alignItems: "center" }}>{retire}</View>
              {del}
            </View>
          );
        })}
        <View style={styles.tableFoot}>
          <Text style={[type.label, { color: t.text2 }]}>Total</Text>
          <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(result.d.budgetTotal)}/mo</Text>
        </View>
        <View style={[styles.tableFoot, { paddingTop: 0 }]}>
          <Text style={[type.caption, { color: t.text3 }]}>In retirement (plus healthcare)</Text>
          <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]}>{money(result.d.retireMonthly - state.healthcare)}/mo</Text>
        </View>
      </Card>
      <Button title="Add budget item" icon="plus" onPress={() => update((p) => { p.budget.push({ id: newId(), name: "", amount: 0, inRetirement: true }); })} />
    </>
  );
}

/* ---------- Accounts ---------- */

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "pretax", label: "Pre-tax" },
  { value: "roth", label: "Roth" },
  { value: "taxable", label: "Brokerage" },
  { value: "hsa", label: "HSA" },
  { value: "cash", label: "Cash" },
];

function AccountsSection() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Pre-tax = traditional 401(k) / IRA. Cash is your emergency fund. HSA counts as invested.
      </Text>
      {state.accounts.length === 0 ? <Empty text="No accounts yet" /> : null}
      {state.accounts.map((a, i) => (
        <ItemCard
          key={a.id}
          label="Account"
          name={a.name}
          onName={(v) => update((p) => { p.accounts[i]!.name = v; })}
          onDelete={() => removeItem("this account", a.name, () => update((p) => { p.accounts.splice(i, 1); }))}
        >
          <Segmented label="Account type" options={ACCOUNT_TYPES} value={a.type} onChange={(v) => update((p) => { p.accounts[i]!.type = v; })} />
          <FieldRow label="Balance">
            <NumberInput kind="money" label={`${a.name} balance`} value={a.balance} min={0} onChange={(v) => update((p) => { p.accounts[i]!.balance = v; })} />
          </FieldRow>
        </ItemCard>
      ))}
      <Button title="Add account" icon="plus" onPress={() => update((p) => { p.accounts.push({ id: newId(), name: "New account", type: "taxable", balance: 0 }); })} />
    </>
  );
}

/* ---------- Debts ---------- */

function DebtsSection() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Minimum payments come out of your budget every month. Extra payments go to the highest interest rate first.
      </Text>
      {state.debts.length === 0 ? <Empty text="No debts. Nice." /> : null}
      {state.debts.map((dt, i) => (
        <ItemCard
          key={dt.id}
          label="Debt"
          name={dt.name}
          onName={(v) => update((p) => { p.debts[i]!.name = v; })}
          onDelete={() => removeItem("this debt", dt.name, () => update((p) => { p.debts.splice(i, 1); }))}
        >
          <Rows>
            {[
              <FieldRow key="b" label="Balance">
                <NumberInput kind="money" label={`${dt.name} balance`} value={dt.balance} min={0} onChange={(v) => update((p) => { p.debts[i]!.balance = v; })} />
              </FieldRow>,
              <FieldRow key="a" label="Interest rate (APR)">
                <NumberInput kind="percent" label={`${dt.name} APR`} value={dt.apr} min={0} onChange={(v) => update((p) => { p.debts[i]!.apr = v; })} />
              </FieldRow>,
              <FieldRow key="m" label="Minimum payment" hint="Per month">
                <NumberInput kind="money" label={`${dt.name} minimum payment`} value={dt.minPayment} min={0} onChange={(v) => update((p) => { p.debts[i]!.minPayment = v; })} />
              </FieldRow>,
            ]}
          </Rows>
        </ItemCard>
      ))}
      <Button title="Add debt" icon="plus" onPress={() => update((p) => { p.debts.push({ id: newId(), name: "New debt", balance: 0, apr: 0.1, minPayment: 0 }); })} />
    </>
  );
}

/* ---------- Goals ---------- */

function GoalsSection() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Each goal becomes a step in your plan (a house deposit, a car, a wedding). Reorder it on the Plan tab.
      </Text>
      {state.goals.length === 0 ? <Empty text="No goals yet" /> : null}
      {state.goals.map((g, i) => (
        <ItemCard
          key={g.id}
          label="Goal"
          name={g.name}
          onName={(v) => update((p) => { p.goals[i]!.name = v; })}
          onDelete={() => removeItem("this goal", g.name, () => update((p) => { p.goals.splice(i, 1); }))}
        >
          <Rows>
            {[
              <FieldRow key="t" label="Target">
                <NumberInput kind="money" label={`${g.name} target`} value={g.target} min={0} onChange={(v) => update((p) => { p.goals[i]!.target = v; })} />
              </FieldRow>,
              <FieldRow key="s" label="Saved so far">
                <NumberInput kind="money" label={`${g.name} saved so far`} value={g.saved} min={0} onChange={(v) => update((p) => { p.goals[i]!.saved = v; })} />
              </FieldRow>,
            ]}
          </Rows>
        </ItemCard>
      ))}
      <Button title="Add goal" icon="plus" onPress={() => update((p) => { p.goals.push({ id: newId(), name: "New goal", target: 5000, saved: 0 }); })} />
    </>
  );
}

/* ---------- Assumptions & plan rules ---------- */

function AssumptionsSection() {
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const pct = (label: string, hint: string, value: number, set: (v: number) => void, max = 1) => (
    <FieldRow key={label} label={label} hint={hint}>
      <NumberInput kind="percent" label={label} value={value} min={0} max={max} onChange={set} />
    </FieldRow>
  );
  return (
    <>
      <Group title="Market assumptions" hint="Everything is in today's dollars, so returns and raises are after inflation. Conservative defaults: 5% return, 15% volatility, 3.5% withdrawal, 0% raises.">
        <Rows>
          {[
            pct("Real return", "After inflation. 4.5–5.5% is a sober range for a stock-heavy portfolio.", state.ret, (v) => update((p) => { p.ret = v; }), 0.2),
            pct("Volatility", "How much returns swing year to year (stocks ≈ 15–18%).", state.vol, (v) => update((p) => { p.vol = v; }), 0.6),
            pct("Fees", "Average expense ratio of your funds.", state.fee, (v) => update((p) => { p.fee = v; }), 0.05),
            pct("Withdrawal rate", "Share of the portfolio you'd spend each year. Above 4% raises the risk of running out.", state.swr, (v) => update((p) => { p.swr = Math.max(0.001, v); }), 0.1),
            pct("Tax on pre-tax withdrawals", "Average tax on 401(k)/traditional IRA money in retirement.", state.taxRate, (v) => update((p) => { p.taxRate = Math.min(0.9, v); }), 0.9),
            pct("Real raises per year", "Above inflation, applied to all income. 0% is the conservative default.", state.contribGrowth, (v) => update((p) => { p.contribGrowth = v; }), 0.2),
          ]}
        </Rows>
      </Group>
      <Group title="Plan rules">
        <Rows>
          {[
            <FieldRow key="s" label="Starter emergency fund" hint="A small cushion before anything else">
              <NumberInput kind="money" label="Starter emergency fund" value={state.plan.starterEF} min={0} onChange={(v) => update((p) => { p.plan.starterEF = v; })} />
            </FieldRow>,
            <FieldRow key="e" label="Full emergency fund" hint="Months of budget + debt minimums">
              <NumberInput kind="decimal" label="Full emergency fund in months" value={state.plan.efMonths} min={0} max={24} onChange={(v) => update((p) => { p.plan.efMonths = v; })} />
            </FieldRow>,
            pct('"High-interest" debt starts at', "Debts at or above this APR are paid off before investing beyond the match.", state.plan.highApr, (v) => update((p) => { p.plan.highApr = v; })),
            pct("Your marginal tax rate", "Federal + state bracket. Used to work out what extra 401(k) costs in take-home pay.", state.plan.marginalTax, (v) => update((p) => { p.plan.marginalTax = v; }), 0.6),
            <ToggleRow key="h" label="HSA-eligible health plan" value={state.plan.hsaEligible} onChange={(v) => update((p) => { p.plan.hsaEligible = v; })} />,
            state.plan.hsaEligible ? <ToggleRow key="hf" label="HSA family coverage" value={state.plan.hsaFamily} onChange={(v) => update((p) => { p.plan.hsaFamily = v; })} /> : null,
            <FieldRow key="pw" label="Project the future using" stacked>
              <Segmented
                label="Project the future using"
                options={[{ value: "plan", label: "This plan" }, { value: "current", label: "What I invest today" }]}
                value={state.plan.projectWith}
                onChange={(v) => update((p) => { p.plan.projectWith = v; })}
              />
            </FieldRow>,
          ]}
        </Rows>
      </Group>
    </>
  );
}

/* ---------- Contribution limits ---------- */

function LimitsSection() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const fields: { k: "k401" | "k401Catch" | "ira" | "iraCatch" | "hsaSelf" | "hsaFamily" | "hsaCatch"; label: string }[] = [
    { k: "k401", label: "401(k)" },
    { k: "k401Catch", label: "401(k) catch-up (50+)" },
    { k: "ira", label: "IRA" },
    { k: "iraCatch", label: "IRA catch-up (50+)" },
    { k: "hsaSelf", label: "HSA, self" },
    { k: "hsaFamily", label: "HSA, family" },
    { k: "hsaCatch", label: "HSA catch-up (55+)" },
  ];
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Years after the last row reuse it (limits roughly track inflation, so flat is right in today's dollars). Update when the IRS publishes new limits.
      </Text>
      {[...state.limits].sort((a, b) => a.year - b.year).map((row) => {
        const i = state.limits.indexOf(row);
        return (
          <Card key={`${row.year}-${i}`} style={{ gap: space.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Text style={[type.heading, { color: t.text }]}>Year</Text>
                <NumberInput kind="int" width={100} label="Year" value={row.year} min={2000} max={2100} onChange={(v) => update((p) => { p.limits[i]!.year = v; })} />
              </View>
              <IconButton icon="trash" label={`Remove ${row.year}`} disabled={state.limits.length <= 1} onPress={() => update((p) => { p.limits.splice(i, 1); })} />
            </View>
            <Rows>
              {fields.map((f) => (
                <FieldRow key={f.k} label={f.label}>
                  <NumberInput kind="money" label={`${row.year} ${f.label}`} value={row[f.k]} min={0} onChange={(v) => update((p) => { p.limits[i]![f.k] = v; })} />
                </FieldRow>
              ))}
            </Rows>
          </Card>
        );
      })}
      <Button
        title="Add year"
        icon="plus"
        onPress={() =>
          update((p) => {
            const last = [...p.limits].sort((a, b) => a.year - b.year).at(-1)!;
            p.limits.push({ ...last, year: last.year + 1 });
          })
        }
      />
    </>
  );
}

/* ---------- Backup & restore ---------- */

function DataSection() {
  const t = useTheme();
  const exportJson = useStore((s) => s.exportJson);
  const importJson = useStore((s) => s.importJson);
  const resetToSample = useStore((s) => s.resetToSample);
  const startFresh = useStore((s) => s.startFresh);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const doExport = async () => {
    const json = exportJson();
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `coastfi-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Downloaded your backup file." });
    } else {
      await Share.share({ message: json, title: "Coast FI backup" });
    }
  };
  const doImport = async () => {
    if (!text.trim()) return;
    if (!(await confirm("Replace your plan?", "Importing replaces your current plan and check-ins with the file's contents.", "Import"))) return;
    try {
      importJson(text);
      setText("");
      setMsg({ ok: true, text: "Imported. Your plan has been updated." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error && e.message ? `Couldn't import: ${e.message}` : "That doesn't look like a valid export." });
    }
  };

  return (
    <>
      <Group title="Export">
        <View style={{ paddingVertical: space.sm, gap: space.md }}>
          <Text style={[type.body, { color: t.text2 }]}>Your data lives on this device. Export a backup file to keep a copy or move to another device.</Text>
          <Button title={Platform.OS === "web" ? "Download backup" : "Share backup"} tone="primary" icon="database" onPress={doExport} style={{ alignSelf: "flex-start" }} />
        </View>
      </Group>
      <Group title="Import" hint="Works with backups from this app and exports from the original Coast FI prototype.">
        <View style={{ paddingVertical: space.sm, gap: space.md }}>
          <TextInput
            accessibilityLabel="Paste backup JSON"
            multiline
            value={text}
            onChangeText={setText}
            placeholder="Paste backup JSON here"
            placeholderTextColor={t.text3}
            style={[styles.textarea, { color: t.text, backgroundColor: t.surface2, borderColor: t.border }]}
          />
          <Button title="Import" icon="plus" onPress={doImport} disabled={!text.trim()} style={{ alignSelf: "flex-start" }} />
        </View>
      </Group>
      {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
      <Group title="Start over">
        <View style={{ paddingVertical: space.sm, gap: space.md }}>
          <Text style={[type.body, { color: t.text2 }]}>Check-ins are kept either way.</Text>
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            <Button
              title="Load sample plan"
              onPress={async () => { if (await confirm("Load the sample plan?", "Your current plan will be replaced with sample data.", "Load sample")) resetToSample(); }}
            />
            <Button
              title="Start from scratch"
              tone="danger"
              onPress={async () => { if (await confirm("Start from scratch?", "Your current plan will be cleared.", "Clear plan")) startFresh(defaultPlanState()); }}
            />
          </View>
        </View>
      </Group>
    </>
  );
}

export const SECTION_SCREENS: Record<SectionKey, ComponentType> = {
  profile: Profile,
  income: IncomeSection,
  budget: BudgetSection,
  accounts: AccountsSection,
  debts: DebtsSection,
  goals: GoalsSection,
  assumptions: AssumptionsSection,
  limits: LimitsSection,
  data: DataSection,
};

const styles = StyleSheet.create({
  summary: { borderRadius: radius.md, padding: space.md, gap: space.xs },
  pair: { flexDirection: "row", alignItems: "center", gap: space.sm },
  tableHead: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  tableRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  tableFoot: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.md },
  textarea: { minHeight: 120, borderWidth: 1, borderRadius: radius.sm, padding: space.md, fontFamily: Platform.select({ web: "ui-monospace, monospace", default: undefined }), fontSize: 12, textAlignVertical: "top" },
});
