import { accountGroup, type Account, type AccountType, type PlanAccount } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { confirm } from "../lib/confirm";
import { HELP } from "../lib/help";
import { usePlan } from "../lib/plan";
import { newId, useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { Button, Choice, IconButton, NumberInput, TextField } from "./form";
import { Icon } from "./Icon";
import { Card, Divider } from "./ui";
import { contributionKey, MonthlyAmount, PayrollNote, plannedNow } from "./ScheduleEditor";
import { money } from "../lib/format";
import { monthKey } from "../lib/store";

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "pretax", label: "Pre-tax" },
  { value: "roth", label: "Roth" },
  { value: "taxable", label: "Brokerage" },
  { value: "hsa", label: "HSA" },
  { value: "cash", label: "Cash" },
  { value: "property", label: "Property" },
];
const COUNTS: { value: PlanAccount; label: string }[] = [
  { value: "k401", label: "401(k)" },
  { value: "ira", label: "IRA" },
  { value: "hsa", label: "HSA" },
  { value: "taxable", label: "Brokerage" },
  { value: "other", label: "Other" },
];
const typeLabel = (k: AccountType) => ACCOUNT_TYPES.find((x) => x.value === k)?.label ?? k;

/** One-tap ways to add the common accounts. */
const QUICK_ADD: { name: string; type: AccountType }[] = [
  { name: "401(k)", type: "pretax" },
  { name: "Traditional IRA", type: "pretax" },
  { name: "Roth 401(k)", type: "roth" },
  { name: "Roth IRA", type: "roth" },
  { name: "HSA", type: "hsa" },
  { name: "Brokerage", type: "taxable" },
  { name: "Savings", type: "cash" },
  { name: "Home", type: "property" },
  { name: "Rental property", type: "property" },
  { name: "Other", type: "taxable" },
];

/**
 * Every account as one compact row (name, type, balance). Open a row to rename it, change its
 * type, move it up or down, or remove it. Used in setup and in Settings.
 */
export function AccountsEditor() {
  const t = useTheme();
  const { state, start } = usePlan();
  const update = useStore((s) => s.update);
  const [open, setOpen] = useState<string | null>(null);
  const thisMonth = monthKey(start);
  const [reorder, setReorder] = useState(false);
  const accounts = state.accounts;

  const add = (q: (typeof QUICK_ADD)[number]) => {
    const id = newId();
    update((p) => { p.accounts.push({ id, name: q.name === "Other" ? "" : q.name, type: q.type, balance: 0 }); });
    setOpen(id);
  };
  const move = (i: number, by: -1 | 1) =>
    update((p) => {
      const j = i + by;
      if (j < 0 || j >= p.accounts.length) return;
      [p.accounts[i], p.accounts[j]] = [p.accounts[j]!, p.accounts[i]!];
    });
  const remove = async (a: Account, i: number) => {
    if (a.balance > 0 && !(await confirm("Remove this account?", `"${a.name || "This account"}" will be removed from your plan.`, "Remove"))) return;
    update((p) => { p.accounts.splice(i, 1); });
  };

  return (
    <View style={{ gap: space.md }}>
      {accounts.length > 1 ? (
        <View style={[styles.row, { justifyContent: "flex-end", marginBottom: -space.sm }]}>
          <Button
            title={reorder ? "Done" : "Reorder"}
            icon={reorder ? "check" : "sliders"}
            tone="ghost"
            onPress={() => { setOpen(null); setReorder((r) => !r); }}
            style={{ minHeight: 36 }}
          />
        </View>
      ) : null}
      {accounts.length ? (
        <Card style={{ paddingVertical: space.xs }}>
          {accounts.map((a, i) => {
            const isOpen = open === a.id;
            const name = a.name.trim() || "Unnamed account";
            const ck = contributionKey(state, a);
            const per = ck && ck !== "payroll" ? plannedNow(state, ck, thisMonth) : undefined;
            return (
              <View key={a.id}>
                {i > 0 ? <Divider /> : null}
                <View style={[styles.row, { paddingVertical: space.md }]}>
                  <Pressable
                    role="button"
                    aria-expanded={isOpen}
                    accessibilityLabel={`${name} details`}
                    accessibilityState={{ expanded: isOpen }}
                    disabled={reorder}
                    onPress={() => setOpen(isOpen ? null : a.id)}
                    style={[styles.row, { flex: 1, minHeight: 36 }]}
                  >
                    {reorder ? null : (
                      <View style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}>
                        <Icon name="chevron" size={18} color={t.text3} />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={[type.body, { color: a.name.trim() ? t.text : t.text3 }]} numberOfLines={1}>{name}</Text>
                      <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>
                        {typeLabel(a.type)}
                        {per !== undefined ? <Text style={{ color: t.accent, fontWeight: "700" }}> · +{money(per)}/mo</Text> : null}
                      </Text>
                    </View>
                  </Pressable>
                  {reorder ? (
                    <View style={styles.row}>
                      <IconButton icon="up" label={`Move ${name} up`} disabled={i === 0} onPress={() => move(i, -1)} />
                      <IconButton icon="down" label={`Move ${name} down`} disabled={i === accounts.length - 1} onPress={() => move(i, 1)} />
                    </View>
                  ) : (
                    <NumberInput kind="money" label={`${name} balance`} value={a.balance} onChange={(v) => update((p) => { p.accounts[i]!.balance = v; })} />
                  )}
                </View>
                {isOpen ? (
                  <View style={{ gap: space.sm, paddingBottom: space.md, paddingLeft: 26 }}>
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
                    {a.type !== "cash" && a.type !== "property" ? (
                      <>
                        <Choice
                          label="Counts as"
                          options={COUNTS}
                          value={(accountGroup(a) ?? "other") as PlanAccount}
                          onChange={(v) => update((p) => { p.accounts[i]!.counts = v; })}
                        />
                        <Text style={[type.caption, { color: t.text3 }]}>
                          Which account it is on the Plan tab. The plan adds to your 401(k), IRA, HSA and brokerage; pick Other for accounts it doesn't add to (an old employer's plan, a pension, a rollover).
                        </Text>
                      </>
                    ) : null}
                    <View style={[styles.row, { justifyContent: "space-between" }]}>
                      <View style={styles.row}>
                        <IconButton icon="up" label={`Move ${name} up`} disabled={i === 0} onPress={() => move(i, -1)} />
                        <IconButton icon="down" label={`Move ${name} down`} disabled={i === accounts.length - 1} onPress={() => move(i, 1)} />
                      </View>
                      <Button title="Remove" icon="trash" tone="danger" onPress={() => void remove(a, i)} style={{ minHeight: 36 }} />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : (
        <Card style={{ alignItems: "center", paddingVertical: space.xl }}>
          <Text style={[type.body, { color: t.text3 }]}>No accounts yet</Text>
        </Card>
      )}
      <View style={{ gap: space.sm }}>
        <Text style={[type.label, { color: t.text2 }]}>Add an account</Text>
        <View style={styles.chips}>
          {QUICK_ADD.map((q) => (
            <Button key={q.name} title={q.name} icon="plus" onPress={() => add(q)} style={{ minHeight: 36, paddingHorizontal: space.md }} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
