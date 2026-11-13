/**
 * Homes and rentals: what each is worth (net worth), whether it's your home or a rental, its
 * mortgage and its rent, and what it costs to keep that isn't in the mortgage payment.
 */
import type { Property } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { HELP } from "../lib/help";
import { usePlan } from "../lib/plan";
import { newId, useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { Button, Choice, FieldRow, IconButton, NumberInput, Select, TextField, ToggleRow } from "./form";
import { Icon } from "./Icon";
import { Card, Divider } from "./ui";

const KINDS: { value: Property["kind"]; label: string }[] = [
  { value: "home", label: "My home" },
  { value: "rental", label: "Rental" },
];

export function PropertiesEditor({ titled = true }: { /** Off on its own page, which already says "Homes & rentals". */ titled?: boolean } = {}) {
  const t = useTheme();
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  const props = state.properties ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const mortgages = state.debts.filter((d) => d.kind === "mortgage" && !d.payroll);
  const rents = state.incomes.filter((i) => (i.kind ?? "job") === "rental");
  const change = (id: string, patch: Partial<Property>) =>
    update((p) => {
      const list = p.properties ?? [];
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return;
      const next = { ...list[i]!, ...patch };
      for (const k of Object.keys(next) as (keyof Property)[]) if (next[k] === undefined) delete next[k];
      list[i] = next;
      // a mortgage or a rent belongs to one property
      if (patch.mortgageId) list.forEach((x, j) => { if (j !== i && x.mortgageId === patch.mortgageId) delete x.mortgageId; });
      if (patch.incomeId) list.forEach((x, j) => { if (j !== i && x.incomeId === patch.incomeId) delete x.incomeId; });
      p.properties = list;
    });
  const rentCushion = (x: Property) => {
    const r = result.d.rentals.find((y) => y.id === x.id);
    const owed = x.kind === "rental" ? result.mortgagesAtRetire.find((y) => y.id === x.mortgageId) : undefined;
    return (
      <>
        <FieldRow label="Cushion for empty months" hint="A share of the rent set aside for vacancies and surprises. 5% is a common guess.">
          <NumberInput kind="percent" label={`${x.name || "Property"} cushion for empty months`} value={x.vacancy ?? 0.05} max={0.5} onChange={(v) => change(x.id, { vacancy: Math.abs(v - 0.05) < 1e-9 ? undefined : v })} />
        </FieldRow>
        {r ? (
          <View style={[styles.note, { backgroundColor: r.monthly >= 0 ? t.accentSoft : t.warnSoft }]}>
            <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>
              In retirement: {r.monthly >= 0 ? `about ${money(r.monthly, { whole: true })}/mo` : `costs you about ${money(-r.monthly, { whole: true })}/mo`}
            </Text>
            <Text style={[type.caption, { color: t.text2 }]}>
              {money(r.rent, { whole: true })} rent − {money(r.vacancy, { whole: true })} cushion{r.escrow > 0.5 ? ` − ${money(r.escrow, { whole: true })} escrow (tax + insurance keep going)` : ""}. It counts as income in retirement, so your number is lower.
              {x.kind === "rental"
                ? owed ? ` Its mortgage, about ${money(owed.balance, { whole: true })} still owed when you retire, counts in your number instead of coming out of the rent.` : " Its mortgage is paid off by then."
                : " Your home's own costs are already in your retirement spending."}
            </Text>
          </View>
        ) : null}
      </>
    );
  };
  const add = (kind: Property["kind"]) => {
    const id = newId();
    update((p) => { p.properties = [...(p.properties ?? []), { id, name: kind === "home" ? "Home" : "Rental", kind, value: 0 }]; });
    setOpen(id);
  };

  return (
    <Card style={{ gap: space.sm }}>
      {titled ? <Text role="heading" aria-level={2} style={[type.heading, { color: t.text }]}>Homes and rentals</Text> : null}
      <Text style={[type.caption, { color: t.text3 }]}>
        What they're worth counts in your net worth, not in Coast FI (it isn't money you can invest). A rental's costs come out of its rent, so they stay out of your retirement spending.
      </Text>
      {props.map((x, n) => {
        const isOpen = open === x.id;
        const mortgage = state.debts.find((d) => d.id === x.mortgageId);
        const rent = state.incomes.find((i) => i.id === x.incomeId);
        const escrow = mortgage ? Math.min(Math.max(0, mortgage.escrow ?? 0), mortgage.minPayment) : 0;
        return (
          <View key={x.id}>
            {n > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <Pressable role="button" aria-expanded={isOpen} accessibilityLabel={`${x.name || "Property"} details`} onPress={() => setOpen(isOpen ? null : x.id)} style={[styles.row, { flex: 1 }]}>
                <View style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}>
                  <Icon name="chevron" size={16} color={t.text3} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.body, { color: t.text, fontWeight: "600" }]} numberOfLines={1}>{x.name || "Property"}</Text>
                  <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>
                    {x.kind === "rental" ? "Rental" : "Home"}
                    {mortgage ? ` · owe ${money(mortgage.balance, { whole: true })}` : ""}
                    {rent ? ` · rent from ${rent.name || "income"}` : ""}
                  </Text>
                </View>
              </Pressable>
              <NumberInput kind="money" label={`${x.name || "Property"} value`} value={x.value} onChange={(v) => change(x.id, { value: v })} />
            </View>
            {isOpen ? (
              <View style={{ gap: space.sm, paddingBottom: space.md, paddingLeft: 26 }}>
                <TextField label="Name" placeholder="e.g. 710 Dillon Way" value={x.name} onChange={(v) => change(x.id, { name: v })} />
                <Choice label="It's" options={KINDS} value={x.kind} onChange={(v) => change(x.id, { kind: v })} />
                <FieldRow label="What it's worth" hint="Roughly what it would sell for" info={HELP.property}>
                  <NumberInput kind="money" label={`${x.name || "Property"} value`} value={x.value} onChange={(v) => change(x.id, { value: v })} />
                </FieldRow>
                <FieldRow label="Its mortgage" hint={mortgages.length ? "From Debts" : "Add it under Debts (a mortgage)"}>
                  <Select
                    label={`${x.name || "Property"} mortgage`}
                    value={x.mortgageId ?? ""}
                    options={[{ value: "", label: "None" }, ...mortgages.map((d) => ({ value: d.id, label: d.name || "Mortgage" }))]}
                    onChange={(v) => change(x.id, { mortgageId: v || undefined })}
                  />
                </FieldRow>
                <FieldRow label="Its rent" hint={rents.length ? "A rental income (Money → Income)" : "Add the rent as a rental income (Money → Income)"}>
                  <Select
                    label={`${x.name || "Property"} rent`}
                    value={x.incomeId ?? ""}
                    options={[{ value: "", label: "None" }, ...rents.map((i) => ({ value: i.id, label: i.name || "Rental income" }))]}
                    onChange={(v) => change(x.id, { incomeId: v || undefined })}
                  />
                </FieldRow>
                {x.kind === "home" ? (
                  <>
                    {escrow > 0.5 && !x.taxInsurance ? (
                      <Text style={[type.caption, { color: t.text2 }]}>Property tax + insurance: in its mortgage escrow ({money(escrow, { whole: true })}/mo), which keeps going after the loan is paid off.</Text>
                    ) : (
                      <FieldRow label="Property tax + insurance a year" hint="Paid on your own, not through mortgage escrow">
                        <NumberInput kind="money" label={`${x.name || "Property"} property tax and insurance a year`} value={x.taxInsurance ?? 0} onChange={(v) => change(x.id, { taxInsurance: v > 0 ? v : undefined })} />
                      </FieldRow>
                    )}
                    <FieldRow label="Upkeep a year" hint={`Repairs and maintenance, as a share of its value. About 1% is common${(x.upkeep ?? 0) > 0 ? ` (${money(x.value * (x.upkeep ?? 0), { whole: true })} a year)` : ""}.`}>
                      <NumberInput kind="percent" label={`${x.name || "Property"} upkeep a year`} value={x.upkeep ?? 0} max={0.1} onChange={(v) => change(x.id, { upkeep: v > 0 ? v : undefined })} />
                    </FieldRow>
                    <Text style={[type.caption, { color: t.text3 }]}>These count in your retirement spending, so your number covers them. Today's costs belong in your budget.</Text>
                    {rent ? (
                      <>
                        <ToggleRow
                          label="Keep renting it out after you retire"
                          hint={x.inRetirement ? "Its rent keeps coming, so your savings cover less" : "Off: the rent stops when you retire"}
                          value={!!x.inRetirement}
                          onChange={(v) => change(x.id, { inRetirement: v ? true : undefined })}
                        />
                        {x.inRetirement ? rentCushion(x) : null}
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text style={[type.caption, { color: t.text3 }]}>
                      A rental: its rent pays its mortgage, tax, insurance and upkeep, so none of them count in your spending. The rent counts as income{rent ? "" : " once you add it"}.
                    </Text>
                    {rent ? (
                      <>
                        <ToggleRow
                          label="Keep it after you retire"
                          hint={x.inRetirement === false ? "Off: you'll sell it first, so its rent stops when you retire" : "Its rent keeps coming, so your savings cover less"}
                          value={x.inRetirement !== false}
                          onChange={(v) => change(x.id, { inRetirement: v ? undefined : false })}
                        />
                        {x.inRetirement !== false ? rentCushion(x) : null}
                      </>
                    ) : null}
                  </>
                )}
                <View style={[styles.row, { justifyContent: "flex-end" }]}>
                  <IconButton icon="trash" color={t.bad} label={`Remove ${x.name || "property"}`} onPress={() => update((p) => { p.properties = (p.properties ?? []).filter((y) => y.id !== x.id); })} />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={[styles.row, { flexWrap: "wrap" }]}>
        <Button title="Add a home" icon="plus" onPress={() => add("home")} style={{ minHeight: 36 }} />
        <Button title="Add a rental" icon="plus" tone="ghost" onPress={() => add("rental")} style={{ minHeight: 36 }} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  note: { borderRadius: 10, padding: space.md, gap: 2 },
});
