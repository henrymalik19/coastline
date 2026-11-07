/**
 * Cards that used to live on the Money tab: what you own and owe (on Home), and savings goals
 * (on Progress). Editing happens in Settings → Your money.
 */
import { nextDue, type AccountType } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { debtLabel } from "../lib/debts";
import { money, percent } from "../lib/format";
import { paycheckFor } from "../lib/loans";
import { netWorth } from "../lib/networth";
import { usePlan } from "../lib/plan";
import { budgetAccounts } from "../lib/register";
import { monthKey } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { ACCOUNT_TYPES } from "./AccountsEditor";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressRing";
import { dueLabel, everyLabel } from "./RecurringGoalFields";
import { contributionKey, plannedNow } from "./ScheduleEditor";
import { Card, Divider } from "./ui";

const typeLabel = (k: AccountType) => ACCOUNT_TYPES.find((x) => x.value === k)?.label ?? k;
const pct = (v: number) => percent(v, 1).replace(/\.0%$/, "%");

/** Net worth, with what you own and owe one tap away. */
export function NetWorthCard({ startOpen = false }: { startOpen?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const { state, result, start } = usePlan();
  const [open, setOpen] = useState(startOpen);
  const d = result.d;
  const cash = d.bal.cash;
  const property = d.bal.property ?? 0;
  const worth = netWorth(d, state);
  const debts = state.debts.filter((x) => x.balance > 0);
  const registered = new Set(Object.keys(state.budgetPlan?.registers ?? {}));
  const budgetIds = new Set(budgetAccounts(state).map((a) => a.id));

  return (
    <Card style={{ gap: space.sm }}>
      <Pressable role="button" aria-expanded={open} accessibilityLabel={`Net worth ${money(worth)}: ${open ? "hide" : "show"} what you own and owe`} onPress={() => setOpen((v) => !v)} style={{ gap: space.sm }}>
        <View style={styles.line}>
          <Text style={[type.label, { color: t.text3, flex: 1 }]}>Net worth</Text>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{open ? "Hide" : "What you own and owe"}</Text>
          <View style={{ transform: [{ rotate: open ? "-90deg" : "90deg" }] }}>
            <Icon name="chevron" size={12} color={t.accent} />
          </View>
        </View>
        <Text style={[type.display, { color: worth < 0 ? t.bad : t.text, fontVariant: ["tabular-nums"] }]}>{money(worth)}</Text>
        <View style={styles.trio}>
          <Mini label="Invested" value={money(d.invested)} />
          <Mini label="Cash" value={money(cash)} />
          {property > 0 ? <Mini label="Property" value={money(property)} /> : null}
          <Mini label="Debts" value={money(d.debtTotal)} />
        </View>
      </Pressable>
      {open ? (
        <>
          <Divider />
          <Group title="What you own" total={money(d.invested + cash + property)} manage="/settings/accounts">
            {state.accounts.length ? (
              state.accounts.map((a) => {
                const ck = contributionKey(state, a);
                const per = ck && ck !== "payroll" ? plannedNow(state, ck, monthKey(start)) : undefined;
                const hint = `${typeLabel(a.type)}${per !== undefined ? ` · +${money(per)}/mo` : ck === "payroll" ? " · from your paycheck" : ""}`;
                return (
                  <Line
                    key={a.id}
                    label={a.name.trim() || "Unnamed account"}
                    hint={hint}
                    value={money(a.balance)}
                    href={budgetIds.has(a.id) && registered.has(a.id) ? `/money/register?account=${a.id}` : "/settings/accounts"}
                  />
                );
              })
            ) : (
              <Empty text="No accounts yet" />
            )}
          </Group>
          <Group title="What you owe" total={debts.length ? money(d.debtTotal) : undefined} manage="/settings/debts">
            {debts.length ? (
              debts.map((x) => {
                const link = paycheckFor(state, x.id);
                const pay = link ? `${money(link.deduction.amount)}/paycheck` : `${money(x.minPayment)}/mo`;
                const rate = x.promoUntil ? `${pct(x.promoApr ?? 0)} intro` : pct(x.apr);
                return <Line key={x.id} label={debtLabel(x)} hint={`${rate} · ${pay}`} value={money(x.balance)} href={registered.has(x.id) ? `/money/register?account=${x.id}` : "/settings/debts"} />;
              })
            ) : (
              <Empty text="No debts" />
            )}
          </Group>
          {property > 0 ? <Text style={[type.caption, { color: t.text3 }]}>Property counts in net worth, not toward Coast FI (you can't spend it without selling).</Text> : null}
          <Pressable role="link" onPress={() => router.push("/settings")} hitSlop={6} style={styles.manage}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Manage income, accounts, debts and goals</Text>
            <Icon name="chevron" size={12} color={t.accent} />
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}

/** The emergency fund and each savings goal, with progress. */
export function GoalsCard() {
  const t = useTheme();
  const router = useRouter();
  const { state, result, start } = usePlan();
  const cash = result.d.bal.cash;
  const goals = state.goals ?? [];
  return (
    <Card style={{ gap: space.xs }}>
      <View style={[styles.line, { marginBottom: space.xs }]}>
        <Text role="heading" aria-level={2} style={[type.heading, { color: t.text, flex: 1 }]}>Savings goals</Text>
        <Pressable role="link" accessibilityLabel="Edit savings goals" onPress={() => router.push("/settings/goals")} hitSlop={8} style={styles.manage}>
          <Text style={[type.label, { color: t.accent, fontWeight: "700" }]}>Edit</Text>
          <Icon name="chevron" size={14} color={t.accent} />
        </Pressable>
      </View>
      {result.plan.fullTarget > 0 ? (
        <GoalRow name="Emergency fund" hint={`${state.plan.efMonths} months of expenses · your cash`} saved={cash} target={result.plan.fullTarget} color={t.good} />
      ) : null}
      {goals.map((g) => (
        <GoalRow
          key={g.id}
          name={g.name || "Goal"}
          hint={g.recurring ? `${everyLabel(g.recurring.every)} · due ${dueLabel(nextDue(g.recurring, monthKey(start)))}` : undefined}
          saved={g.saved}
          target={g.target}
          color={t.series.goals}
        />
      ))}
      {!goals.length ? <Empty text="Saving up for something? Add it as a goal." /> : null}
    </Card>
  );
}

function GoalRow({ name, hint, saved, target, color }: { name: string; hint?: string; saved: number; target: number; color: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6, paddingVertical: space.xs }}>
      <View style={styles.line}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{name}</Text>
          {hint ? <Text style={[type.caption, { color: t.text3 }]}>{hint}</Text> : null}
        </View>
        <Text style={[type.label, { color: t.text2, fontVariant: ["tabular-nums"] }]}>{money(saved)} of {money(target)}</Text>
      </View>
      <ProgressBar progress={target > 0 ? saved / target : 0} color={color} />
    </View>
  );
}

function Group({ title, total, manage, children }: { title: string; total?: string; manage: string; children: ReactNode }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.line}>
        <Text style={[type.overline, { color: t.text3, flex: 1 }]}>{title}</Text>
        {total ? <Text style={[type.label, { color: t.text2, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{total}</Text> : null}
        <Pressable role="link" accessibilityLabel={`Edit ${title.toLowerCase()}`} onPress={() => router.push(manage)} hitSlop={8} style={styles.manage}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Edit</Text>
        </Pressable>
      </View>
      {children}
    </View>
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
    <Pressable role="link" accessibilityLabel={`${label}: ${value}`} onPress={() => router.push(href as never)} style={[styles.line, styles.row]}>
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
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  row: { paddingVertical: 6, minHeight: 40 },
  manage: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4, alignSelf: "flex-start" },
});
