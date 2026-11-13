import { accountGroup, type Account, type AccountType, type PlanAccount } from "@coastfi/engine";
import { useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { confirm } from "../lib/confirm";
import { HELP } from "../lib/help";
import { usePlan } from "../lib/plan";
import { newId, useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { Button, Choice, IconButton, NumberInput, TextField } from "./form";
import { Icon } from "./Icon";
import { Card, Divider } from "./ui";
import { DragList, reorderAmong } from "./DragList";
import { hasRegister, isCard, accountTxnsHref } from "../lib/register";
import { contributionKey, MonthlyAmount, PayrollNote, plannedNow } from "./ScheduleEditor";
import { money } from "../lib/format";
import { monthKey } from "../lib/store";
import { ensureSpouseStep, spouseName } from "../lib/spouse";
import { sticky } from "../lib/sticky";

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "pretax", label: "Pre-tax" },
  { value: "roth", label: "Roth" },
  { value: "taxable", label: "Brokerage" },
  { value: "hsa", label: "HSA" },
  { value: "cash", label: "Cash" },
];
const COUNTS: { value: PlanAccount; label: string }[] = [
  { value: "k401", label: "401(k)" },
  { value: "ira", label: "IRA" },
  { value: "hsa", label: "HSA" },
  { value: "taxable", label: "Brokerage" },
  { value: "other", label: "Other" },
];
const typeLabel = (k: AccountType) => ACCOUNT_TYPES.find((x) => x.value === k)?.label ?? k;

/** How accounts are grouped on the page (by type). Credit cards come from Debts. */
export const ACCOUNT_GROUPS: { key: string; label: string; types: AccountType[] }[] = [
  { key: "cash", label: "Checking & savings", types: ["cash"] },
  { key: "retirement", label: "Retirement & HSA", types: ["pretax", "roth", "hsa"] },
  { key: "invest", label: "Investments", types: ["taxable"] },
];
const groupKeyOf = (a: Account) => ACCOUNT_GROUPS.find((g) => g.types.includes(a.type))?.key ?? "invest";

/** One-tap ways to add the common accounts. */
const QUICK_ADD: { name: string; type: AccountType; label?: string }[] = [
  { name: "401(k)", type: "pretax" },
  { name: "Traditional IRA", type: "pretax" },
  { name: "Roth 401(k)", type: "roth" },
  { name: "Roth IRA", type: "roth" },
  { name: "HSA", type: "hsa" },
  { name: "Brokerage", type: "taxable" },
  { name: "", type: "cash", label: "Checking / savings" },
  { name: "Other", type: "taxable" },
];

/**
 * Every account as one compact row (name, type, balance). Open a row to rename it, change its
 * type or remove it. Grouped by kind (checking & savings, retirement, investments, property, and
 * your credit cards from Debts); drag a row's grip to reorder it within its group. Used in setup and in Settings.
 */
export function AccountsEditor({ afterRetirement }: { /** Shown under the retirement accounts (or after all of them when there are none): what you've contributed this year. */ afterRetirement?: ReactNode } = {}) {
  const t = useTheme();
  const { state, start } = usePlan();
  const update = useStore((s) => s.update);
  const txns = useStore((s) => s.txns);
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const thisMonth = monthKey(start);
  const accounts = state.accounts;

  const sp = state.spouse ? spouseName(state) : null;
  const quick: { name: string; type: AccountType; owner?: "spouse"; label?: string }[] = sp ? [...QUICK_ADD.slice(0, 4), { name: `${sp} Roth IRA`, type: "roth", owner: "spouse" }, ...QUICK_ADD.slice(4)] : QUICK_ADD;
  const add = (q: (typeof quick)[number]) => {
    const id = newId();
    update((p) => { p.accounts.push({ id, name: q.name === "Other" ? "" : q.name, type: q.type, balance: 0, ...(q.owner ? { owner: q.owner, counts: "ira" as const } : {}) }); if (q.owner) ensureSpouseStep(p); });
    setOpen(id);
  };
  const cards = state.debts.filter(isCard);
  const remove = async (a: Account, i: number) => {
    if (a.balance > 0 && !(await confirm("Remove this account?", `"${a.name || "This account"}" will be removed from your plan.`, "Remove"))) return;
    update((p) => { p.accounts.splice(i, 1); });
  };

  return (
    <View style={{ gap: space.md }}>
      {accounts.length || cards.length ? (
        ACCOUNT_GROUPS.map((g) => {
          const inGroup = (x: Account) => groupKeyOf(x) === g.key;
          const list = accounts.filter(inGroup);
          if (!list.length) return null;
          const after = g.key === "retirement" ? afterRetirement : null;
          const total = list.reduce((sum, x) => sum + (+x.balance || 0), 0);
          return (
            <View key={g.key} style={{ gap: space.xs }}>
              <View style={[styles.row, styles.groupHead, sticky(0, t.bg)]}>
                <Text style={[type.overline, { color: t.text3, flex: 1 }]}>{g.label}</Text>
                <Text style={[type.caption, { color: t.text3, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(total)}</Text>
              </View>
              <Card style={{ paddingVertical: space.xs }}>
                <DragList
                  count={list.length}
                  keyOf={(n) => list[n]!.id}
                  nameOf={(n) => list[n]!.name.trim() || "Unnamed account"}
                  onMove={(from, to) => update((p) => { p.accounts = reorderAmong(p.accounts, inGroup, from, to); })}
                  renderItem={(n, grip) => {
                    const a = list[n]!;
                    const i = accounts.indexOf(a);
            const isOpen = open === a.id;
            const name = a.name.trim() || "Unnamed account";
            const ck = contributionKey(state, a);
            const per = ck && ck !== "payroll" ? plannedNow(state, ck, thisMonth) : undefined;
            return (
              <View>
                {n > 0 ? <Divider /> : null}
                <View style={[styles.row, { paddingVertical: space.md }]}>
                  {list.length > 1 ? grip : null}
                  <Pressable
                    role="button"
                    aria-expanded={isOpen}
                    accessibilityLabel={`${name} details`}
                    accessibilityState={{ expanded: isOpen }}
                    onPress={() => setOpen(isOpen ? null : a.id)}
                    style={[styles.row, { flex: 1, minHeight: 36 }]}
                  >
                    <View style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}>
                      <Icon name="chevron" size={18} color={t.text3} />
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={[type.body, { color: a.name.trim() ? t.text : t.text3 }]} numberOfLines={1}>{name}</Text>
                      <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>
                        {typeLabel(a.type)}
                        {sp && a.owner === "spouse" ? ` · ${sp}'s` : ""}
                        {per !== undefined ? <Text style={{ color: t.accent, fontWeight: "700" }}> · +{money(per)}/mo</Text> : null}
                      </Text>
                    </View>
                  </Pressable>
                  {(
                    hasRegister(txns, a.id) ? (
                      <Pressable role="link" accessibilityLabel={`${name} transactions`} onPress={() => router.push(accountTxnsHref(a.id) as never)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={[type.body, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{money(a.balance)}</Text>
                        <Icon name="chevron" size={14} color={t.accent} />
                      </Pressable>
                    ) : (
                      <NumberInput kind="money" label={`${name} balance`} value={a.balance} onChange={(v) => update((p) => { p.accounts[i]!.balance = v; })} />
                    )
                  )}
                </View>
                {isOpen ? (
                  <View style={{ gap: space.sm, paddingBottom: space.md, paddingLeft: 26 }}>
                    {a.type === "cash" ? (
                      <Pressable role="link" onPress={() => router.push(accountTxnsHref(a.id) as never)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" }}>
                        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>
                          {hasRegister(txns, a.id) ? "Transactions (the balance comes from them)" : "Transactions"}
                        </Text>
                        <Icon name="chevron" size={12} color={t.accent} />
                      </Pressable>
                    ) : null}
                    {ck === "payroll" ? (
                      <PayrollNote what={accountGroup(a) === "k401" ? "401(k)" : "HSA"} />
                    ) : ck ? (
                      <MonthlyAmount
                        k={ck}
                        label={name}
                        note={a.type === "cash" ? "Cash can go past your emergency fund goal if you plan it." : undefined}
                      />
                    ) : null}
                    <TextField label="Account name" placeholder="e.g. Fidelity 401(k)" value={a.name} onChange={(v) => update((p) => { p.accounts[i]!.name = v; })} />
                    <Choice label="Account type" options={ACCOUNT_TYPES} value={a.type} onChange={(v) => update((p) => { p.accounts[i]!.type = v; })} />
                    <Text style={[type.caption, { color: t.text3 }]}>{HELP[a.type]}</Text>
                    {a.type !== "cash" ? (
                      <>
                        <Choice
                          label="Counts as"
                          options={COUNTS}
                          value={(accountGroup(a) ?? "other") as PlanAccount}
                          onChange={(v) => update((p) => { p.accounts[i]!.counts = v; })}
                        />
                        <Text style={[type.caption, { color: t.text3 }]}>
                          Which account it is in your budget and forecast. The plan adds to your 401(k), IRA, HSA and brokerage; pick Other for accounts it doesn't add to (an old employer's plan, a pension, a rollover).
                        </Text>
                        {sp && accountGroup(a) === "ira" ? (
                          <>
                            <Choice
                              label="Whose account"
                              options={[{ value: "you", label: "Yours" }, { value: "spouse", label: `${sp}'s` }]}
                              value={a.owner === "spouse" ? "spouse" : "you"}
                              onChange={(v) => update((p) => { if (v === "spouse") { p.accounts[i]!.owner = "spouse"; ensureSpouseStep(p); } else delete p.accounts[i]!.owner; })}
                            />
                            <Text style={[type.caption, { color: t.text3 }]}>Each of you has your own IRA limit. Your Traditional and Roth IRAs share yours.</Text>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    <View style={[styles.row, { justifyContent: "flex-end" }]}>
                      <Button title="Remove" icon="trash" tone="danger" onPress={() => void remove(a, i)} style={{ minHeight: 36 }} />
                    </View>
                  </View>
                ) : null}
              </View>
            );

                  }}
                />
              </Card>
              {after}
            </View>
          );
        })
      ) : (
        <Card style={{ alignItems: "center", paddingVertical: space.xl }}>
          <Text style={[type.body, { color: t.text3 }]}>No accounts yet</Text>
        </Card>
      )}
      {cards.length ? (
        <View style={{ gap: space.xs }}>
          <View style={[styles.row, styles.groupHead, sticky(0, t.bg)]}>
            <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Credit cards</Text>
            <Text style={[type.caption, { color: t.text3, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(cards.reduce((sum, d) => sum + d.balance, 0))} owed</Text>
          </View>
          <Card style={{ paddingVertical: space.xs }}>
            <DragList
              count={cards.length}
              keyOf={(n) => cards[n]!.id}
              nameOf={(n) => cards[n]!.name?.trim() || "Credit card"}
              onMove={(from, to) => update((p) => { p.debts = reorderAmong(p.debts, isCard, from, to); })}
              renderItem={(n, grip) => {
                const d = cards[n]!;
                const name = d.name?.trim() || "Credit card";
                const reg = hasRegister(txns, d.id);
                return (
                  <View>
                    {n > 0 ? <Divider /> : null}
                    <View style={[styles.row, { paddingVertical: space.md }]}>
                      {cards.length > 1 ? grip : null}
                      <Pressable
                        role="link"
                        accessibilityLabel={`${name}: ${reg ? "transactions" : "edit on Debts"}`}
                        onPress={() => router.push((reg ? accountTxnsHref(d.id) : "/money/debts") as never)}
                        style={[styles.row, { flex: 1, minHeight: 36 }]}
                      >
                        <View style={{ flex: 1, gap: 1 }}>
                          <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{name}</Text>
                          <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>Credit card · {reg ? "transactions" : "edit on Debts"}</Text>
                        </View>
                        <Text style={[type.body, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{money(d.balance)} owed</Text>
                        <Icon name="chevron" size={14} color={t.accent} />
                      </Pressable>
                    </View>
                  </View>
                );
              }}
            />
          </Card>
        </View>
      ) : null}
      {!accounts.some((a) => groupKeyOf(a) === "retirement") ? afterRetirement : null}
      <View style={{ gap: space.sm }}>
        <Text style={[type.label, { color: t.text2 }]}>Add an account</Text>
        <View style={styles.chips}>
          {quick.map((q) => (
            <Button key={q.label ?? q.name} title={q.label ?? q.name} icon="plus" onPress={() => add(q)} style={{ minHeight: 36, paddingHorizontal: space.md }} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  groupHead: { paddingHorizontal: space.xs, marginTop: space.xs, paddingVertical: space.xs },
});
