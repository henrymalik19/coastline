import type { RetirementIncome, RetirementIncomeKind } from "@coastfi/engine";
import { StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, FieldRow, IconButton, NumberInput, TextField } from "./form";
import { Card, Divider } from "./ui";

const KINDS: { value: RetirementIncomeKind; label: string; name: string; startAge: number; hint: string }[] = [
  {
    value: "socialSecurity",
    label: "Social Security",
    name: "Social Security",
    startAge: 67,
    hint: "Your estimate is at ssa.gov/myaccount. It goes up with inflation, so use the amount in today's dollars.",
  },
  {
    value: "pension",
    label: "Pension",
    name: "Pension",
    startAge: 65,
    hint: "If it doesn't rise with inflation, enter a bit less than the statement shows, since it buys less each year.",
  },
  { value: "other", label: "Other", name: "", startAge: 65, hint: "An annuity, part-time work or rent you'll keep collecting, per month." },
];
const kindOf = (k: RetirementIncomeKind) => KINDS.find((x) => x.value === k) ?? KINDS[2]!;

/**
 * Social Security, pensions and other money that starts after you stop working. It lowers what your
 * savings must cover; anything that starts after your retirement age is covered from savings until it does.
 */
export function RetirementIncomeEditor() {
  const t = useTheme();
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  const list = state.retirementIncome ?? [];
  const set = (i: number, patch: Partial<RetirementIncome>) =>
    update((p) => { p.retirementIncome![i] = { ...p.retirementIncome![i]!, ...patch }; });
  const add = (k: RetirementIncomeKind) =>
    update((p) => {
      const meta = kindOf(k);
      p.retirementIncome = [...(p.retirementIncome ?? []), { id: newId(), name: meta.name, kind: k, monthly: 0, startAge: Math.max(meta.startAge, 0) }];
    });

  const covered = result.d.retireIncomeAnnual / 12;
  const spend = result.d.retireMonthly;
  return (
    <View style={{ gap: space.md }}>
      {list.length ? (
        <Card style={{ paddingVertical: space.xs }}>
          {list.map((x, i) => {
            const meta = kindOf(x.kind);
            const gap = Math.max(0, x.startAge - state.retireAge);
            return (
              <View key={x.id}>
                {i > 0 ? <Divider /> : null}
                <View style={{ gap: space.xs, paddingVertical: space.sm }}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <TextField label="Name" placeholder={meta.label} value={x.name} onChange={(v) => set(i, { name: v })} />
                    </View>
                    <IconButton icon="trash" color={t.bad} label={`Remove ${x.name || meta.label}`} onPress={() => update((p) => { p.retirementIncome!.splice(i, 1); })} />
                  </View>
                  <FieldRow label="Per month" hint="In today's dollars">
                    <NumberInput kind="money" label={`${x.name || meta.label} per month`} value={x.monthly} onChange={(v) => set(i, { monthly: v })} />
                  </FieldRow>
                  <FieldRow
                    label="Starts at age"
                    hint={gap > 0 ? `${gap} year${gap === 1 ? "" : "s"} after you retire; your savings cover those years` : "Starts by the time you retire"}
                  >
                    <NumberInput kind="int" label={`${x.name || meta.label} start age`} value={x.startAge} min={40} max={80} onChange={(v) => set(i, { startAge: v })} />
                  </FieldRow>
                  <Text style={[type.caption, { color: t.text3 }]}>{meta.hint}</Text>
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}
      <View style={styles.row}>
        {KINDS.map((k) => (
          <Button key={k.value} title={k.label} icon="plus" onPress={() => add(k.value)} style={{ minHeight: 36, paddingHorizontal: space.md }} />
        ))}
      </View>
      {covered > 0 && spend > 0 ? (
        <View style={[styles.note, { backgroundColor: t.accentSoft }]}>
          <Text style={[type.caption, { color: t.text }]}>
            Once it all starts, this covers {money(Math.min(covered, spend))} of your {money(spend)} a month in retirement
            {covered >= spend ? " (all of it)" : ""}, so your savings need to cover less.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  note: { borderRadius: radius.sm, padding: space.md },
});
