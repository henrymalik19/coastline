import type { RetirementIncome, RetirementIncomeKind } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
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

  const router = useRouter();
  const rentals = result.d.rentals;
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
                  <FieldRow label="Per month" info={`In today's dollars. ${meta.hint}`}>
                    <NumberInput kind="money" label={`${x.name || meta.label} per month`} value={x.monthly} onChange={(v) => set(i, { monthly: v })} />
                  </FieldRow>
                  <FieldRow
                    label="Starts at age"
                    info={gap > 0 ? `${gap} year${gap === 1 ? "" : "s"} after you retire; your savings cover those years.` : "It starts by the time you retire."}
                  >
                    <NumberInput kind="int" label={`${x.name || meta.label} start age`} value={x.startAge} min={40} max={80} onChange={(v) => set(i, { startAge: v })} />
                  </FieldRow>
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}
      {rentals.length ? (
        <Card style={{ paddingVertical: space.xs }}>
          {rentals.map((r, i) => (
            <View key={r.id}>
              {i > 0 ? <Divider /> : null}
              <View style={[styles.row, { paddingVertical: space.sm, flexWrap: "nowrap" }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{r.name || "Rental"}</Text>
                  <Text style={[type.caption, { color: t.text3 }]}>{r.kind === "home" ? "Rent from your home" : "Rental you keep"} · from when you retire</Text>
                </View>
                <Text style={[type.body, { color: r.monthly >= 0 ? t.text : t.bad, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>
                  {r.monthly >= 0 ? "" : "−"}{money(Math.abs(r.monthly), { whole: true })}/mo
                </Text>
              </View>
            </View>
          ))}
          <Pressable role="link" onPress={() => router.push("/money/properties")} hitSlop={6} style={{ alignSelf: "flex-start", paddingBottom: space.sm }}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Change under Property →</Text>
          </Pressable>
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
