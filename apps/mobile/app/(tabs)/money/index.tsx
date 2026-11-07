import type { AccountType } from "@coastfi/engine";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ACCOUNT_TYPES } from "../../../components/AccountsEditor";
import { Icon } from "../../../components/Icon";
import { ProgressBar } from "../../../components/ProgressRing";
import { Card, Divider, Screen } from "../../../components/ui";
import { debtLabel } from "../../../lib/debts";
import { money, percent } from "../../../lib/format";
import { useLayout } from "../../../lib/layout";
import { paycheckFor } from "../../../lib/loans";
import { netWorth } from "../../../lib/networth";
import { usePlan } from "../../../lib/plan";
import { space, type, useTheme } from "../../../lib/theme";

const typeLabel = (k: AccountType) => ACCOUNT_TYPES.find((x) => x.value === k)?.label ?? k;
const pct = (v: number) => percent(v, 1).replace(/\.0%$/, "%");

/** Money: where your money stands today. Each card opens its editor. */
export default function MoneyOverview() {
  const t = useTheme();
  const { state, result } = usePlan();
  const { twoColumn } = useLayout();
  const d = result.d;
  const cash = d.bal.cash;
  const property = d.bal.property ?? 0;
  const worth = netWorth(d, state);
  const leftover = d.leanMonthly - d.budgetTotal - d.debtMins;
  const goals = state.goals ?? [];
  const retire = (state.retirementIncome ?? []).filter((x) => x.monthly > 0);
  const debts = state.debts.filter((x) => x.balance > 0);

  const netWorthCard = (
    <Card style={{ gap: space.sm }}>
      <Text style={[type.label, { color: t.text3 }]}>Net worth</Text>
      <Text style={[type.display, { color: worth < 0 ? t.bad : t.text, fontVariant: ["tabular-nums"] }]}>{money(worth)}</Text>
      <View style={styles.trio}>
        <Mini label="Invested" value={money(d.invested)} />
        <Mini label="Cash" value={money(cash)} />
        {property > 0 ? <Mini label="Property" value={money(property)} /> : null}
        <Mini label="Debts" value={money(d.debtTotal)} />
      </View>
      {property > 0 ? (
        <Text style={[type.caption, { color: t.text3 }]}>Property counts in net worth, not toward Coast FI (you can't spend it without selling).</Text>
      ) : null}
    </Card>
  );

  const monthCard = (
    <Section title="Each month" edit="/money/budget" editLabel="Budget">
      <Line label="Take-home" value={money(d.leanMonthly)} href="/money/income" hint={`${state.incomes.length} income source${state.incomes.length === 1 ? "" : "s"}`} />
      <Line label="Budget" value={`− ${money(d.budgetTotal)}`} href="/money/budget" hint={`${state.budget.length} items`} />
      {d.debtMins > 0 ? <Line label="Debt payments" value={`− ${money(d.debtMins)}`} href="/money/debts" /> : null}
      <Divider />
      <View style={[styles.line, { paddingVertical: space.sm }]}>
        <Text style={[type.heading, { color: t.text, flex: 1 }]}>{leftover < 0 ? "Short each month" : "Left over to save"}</Text>
        <Text style={[type.stat, { color: leftover < 0 ? t.bad : t.good, fontVariant: ["tabular-nums"] }]}>{money(leftover)}</Text>
      </View>
    </Section>
  );

  const accountsCard = (
    <Section title="Accounts" edit="/money/accounts" total={money(d.invested + cash + property)}>
      {state.accounts.length ? (
        state.accounts.map((a) => <Line key={a.id} label={a.name.trim() || "Unnamed account"} hint={typeLabel(a.type)} value={money(a.balance)} />)
      ) : (
        <Empty text="No accounts yet" />
      )}
    </Section>
  );

  const debtsCard = (
    <Section title="Debts" edit="/money/debts" total={debts.length ? money(d.debtTotal) : undefined}>
      {debts.length ? (
        debts.map((x) => {
          const link = paycheckFor(state, x.id);
          const pay = link ? `${money(link.deduction.amount)}/paycheck` : `${money(x.minPayment)}/mo`;
          const rate = x.promoUntil ? `${pct(x.promoApr ?? 0)} intro` : pct(x.apr);
          return <Line key={x.id} label={debtLabel(x)} hint={`${rate} · ${pay}`} value={money(x.balance)} />;
        })
      ) : (
        <Empty text="No debts" />
      )}
    </Section>
  );

  const goalsCard = (
    <Section title="Savings goals" edit="/money/goals">
      {goals.length ? (
        goals.map((g) => (
          <View key={g.id} style={{ gap: 6, paddingVertical: space.xs }}>
            <View style={styles.line}>
              <Text style={[type.body, { color: t.text, flex: 1 }]} numberOfLines={1}>{g.name || "Goal"}</Text>
              <Text style={[type.label, { color: t.text2, fontVariant: ["tabular-nums"] }]}>
                {money(g.saved)} of {money(g.target)}
              </Text>
            </View>
            <ProgressBar progress={g.target > 0 ? g.saved / g.target : 0} color={t.series.goals} />
          </View>
        ))
      ) : (
        <Empty text="No goals. Saving up for something? Add it here." />
      )}
    </Section>
  );

  const retireCard = (
    <Section title="Income in retirement" edit="/money/retirementIncome" total={retire.length ? `${money(d.retireIncomeAnnual / 12)}/mo` : undefined}>
      {retire.length ? (
        retire.map((x) => <Line key={x.id} label={x.name || "Income"} hint={`From age ${x.startAge}`} value={`${money(x.monthly)}/mo`} />)
      ) : (
        <Empty text="Expecting Social Security or a pension? Add it to lower what your savings need to cover." />
      )}
    </Section>
  );

  return (
    <Screen title="Money" subtitle="Where your money stands today">
      {netWorthCard}
      {twoColumn ? (
        <View style={styles.cols}>
          <View style={styles.col}>
            {monthCard}
            {debtsCard}
            {retireCard}
          </View>
          <View style={styles.col}>
            {accountsCard}
            {goalsCard}
          </View>
        </View>
      ) : (
        <>
          {monthCard}
          {accountsCard}
          {debtsCard}
          {goalsCard}
          {retireCard}
        </>
      )}
    </Screen>
  );
}

function Section({ title, edit, editLabel, total, children }: { title: string; edit: string; editLabel?: string; total?: string; children: ReactNode }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <Card style={{ gap: space.xs }}>
      <View style={[styles.line, { marginBottom: space.xs }]}>
        <Text role="heading" aria-level={2} style={[type.heading, { color: t.text, flex: 1 }]}>{title}</Text>
        {total ? <Text style={[type.label, { color: t.text2, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{total}</Text> : null}
        <Pressable role="link" accessibilityLabel={`Edit ${editLabel ?? title}`} onPress={() => router.push(edit)} hitSlop={8} style={styles.edit}>
          <Text style={[type.label, { color: t.accent, fontWeight: "700" }]}>Edit</Text>
          <Icon name="chevron" size={14} color={t.accent} />
        </Pressable>
      </View>
      {children}
    </Card>
  );
}

function Line({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const t = useTheme();
  const router = useRouter();
  const body = (
    <>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{label}</Text>
        {hint ? <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>{hint}</Text> : null}
      </View>
      <Text style={[type.body, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </>
  );
  return href ? (
    <Pressable role="link" accessibilityLabel={`${label}: ${value}`} onPress={() => router.push(href)} style={[styles.line, styles.row]}>
      {body}
    </Pressable>
  ) : (
    <View style={[styles.line, styles.row]}>{body}</View>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[type.caption, { color: t.text3 }]}>{label}</Text>
      <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={[type.caption, { color: t.text3, paddingVertical: space.xs }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  trio: { flexDirection: "row", gap: space.md },
  cols: { flexDirection: "row", gap: space.lg, alignItems: "flex-start" },
  col: { flex: 1, gap: space.lg, minWidth: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  row: { paddingVertical: 6, minHeight: 40 },
  edit: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4, paddingLeft: space.sm },
});
