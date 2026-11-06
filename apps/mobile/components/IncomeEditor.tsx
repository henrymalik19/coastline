import { PERIODS, resolveIncome, type Income, type IncomeKind, type PayFreq } from "@coastfi/engine";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money, percent } from "../lib/format";
import { HELP } from "../lib/help";
import { MATCH_PRESETS } from "../lib/presets";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, DateField, FieldRow, IconButton, NumberInput, Segmented, TextField } from "./form";
import { AddChip, MasterDetail } from "./MasterDetail";
import { Card, Divider } from "./ui";
import { confirm } from "../lib/confirm";
import { usePlan } from "../lib/plan";
import { newId, useStore } from "../lib/store";

export const INCOME_KINDS: { value: IncomeKind; label: string; name: string }[] = [
  { value: "job", label: "Job", name: "Job" },
  { value: "business", label: "Business", name: "My business" },
  { value: "rental", label: "Rental", name: "Rental property" },
  { value: "other", label: "Other", name: "Other income" },
];

const FREQS: { value: PayFreq; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "semimonthly", label: "Twice a month" },
  { value: "monthly", label: "Monthly" },
];

/** Fields that only make sense for a job; cleared for other kinds so they never trigger match warnings. */
const NON_JOB = { matchMode: "usd" as const, pretax: 0, match: 0, fullMatch: true, gross: undefined, contribPct: undefined };

export function newIncome(kind: IncomeKind): Income {
  const name = INCOME_KINDS.find((k) => k.value === kind)!.name;
  return kind === "job"
    ? { id: newId(), name, kind, freq: "biweekly", net: 0, matchMode: "pct", gross: 0, contribPct: 0.04, matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02 }
    : { id: newId(), name, kind, freq: "monthly", net: 0, ...NON_JOB };
}

export function IncomeSummary({ inc, marginalTax }: { inc: Income; marginalTax: number }) {
  const t = useTheme();
  const r = resolveIncome(inc);
  const P = PERIODS[r.freq];
  const good = r.fullMatch;
  return (
    <View style={[styles.summary, { backgroundColor: good ? t.goodSoft : t.badSoft }]}>
      <Text style={[type.caption, { color: t.text2 }]}>
        You put in <Text style={{ fontWeight: "700", color: t.text }}>{money(r.pretax)}</Text>/check · your employer adds{" "}
        <Text style={{ fontWeight: "700", color: t.text }}>{money(r.match)}</Text>/check ({money(r.match * P)}/yr).
      </Text>
      {r.matchMode === "pct" && r.gross ? (
        good ? (
          <Text style={[type.caption, { color: t.good, fontWeight: "600" }]}>✓ You're getting the full match.</Text>
        ) : (
          <Text style={[type.caption, { color: t.bad }]}>
            <Text style={{ fontWeight: "700" }}>The full match needs {percent(r.maxPct ?? 0, 2)}.</Text> Going up from {percent(r.contribPct ?? 0, 2)} adds {money(r.gapPre)}/check
            (about {money(r.gapPre * (1 - marginalTax))} less take-home) for <Text style={{ fontWeight: "700" }}>+{money(r.gapMatch * P)}/yr</Text> of free money.
          </Text>
        )
      ) : !good ? (
        <Text style={[type.caption, { color: t.bad }]}>Not getting the full match. Switch to "% of pay" so the plan can work out the gap.</Text>
      ) : null}
    </View>
  );
}

/** One income source: type, schedule, amount, and (for jobs) 401(k) + employer match. */
export function IncomeEditor({
  inc, onChange, onRemove, marginalTax, bare,
}: { inc: Income; onChange: (patch: Partial<Income>) => void; onRemove?: () => void; marginalTax: number; /** No card around it (inside a pane). */ bare?: boolean }) {
  const t = useTheme();
  const kind = inc.kind ?? "job";
  const isJob = kind === "job";
  const [custom, setCustom] = useState(false);
  const preset = MATCH_PRESETS.find(
    (m) => (inc.matchRate1 ?? 0) === m.r1 && (inc.matchUpTo1 ?? 0) === m.u1 && (inc.matchRate2 ?? 0) === m.r2 && (inc.matchUpTo2 ?? 0) === m.u2,
  );
  const amountHelp = kind === "business" ? HELP.businessAmount : kind === "rental" ? HELP.rentalAmount : kind === "other" ? HELP.otherAmount : HELP.takeHome;

  return (
    <Wrap bare={bare}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField label="Income name" placeholder="e.g. Acme Corp" value={inc.name} onChange={(v) => onChange({ name: v })} />
        </View>
        {onRemove ? <IconButton icon="trash" label={`Remove ${inc.name || "this income"}`} onPress={onRemove} /> : null}
      </View>
      <Segmented
        label="Type of income"
        options={INCOME_KINDS.map((k) => ({ value: k.value, label: k.label }))}
        value={kind}
        onChange={(v) => onChange(v === "job" ? { kind: v, matchMode: "pct" } : { kind: v, ...NON_JOB })}
      />

      <View style={{ gap: space.xs, marginTop: space.xs }}>
        <Text style={[type.label, { color: t.text2 }]}>{isJob ? "How often are you paid?" : "How often does it come in?"}</Text>
        <Segmented label="Frequency" options={FREQS} value={inc.freq} onChange={(v) => onChange({ freq: v })} />
      </View>
      <FieldRow
        label={isJob ? "Take-home per paycheck" : `Amount you keep ${inc.freq === "monthly" ? "per month" : "each time"}`}
        hint={isJob ? "What lands in your bank account" : "After taxes and costs"}
        info={amountHelp}
      >
        <NumberInput kind="money" label={isJob ? "Take-home per paycheck" : "Amount you keep"} value={inc.net} onChange={(v) => onChange({ net: v })} />
      </FieldRow>
      {inc.freq === "weekly" || inc.freq === "biweekly" ? (
        <>
          <Divider />
          <FieldRow label={isJob ? "Next payday" : "Next payment date"} hint="Finds your 3-paycheck months" info={HELP.nextPayday}>
            <DateField label="Next payday" value={inc.nextPayday} onChange={(v) => onChange({ nextPayday: v })} />
          </FieldRow>
        </>
      ) : null}

      {isJob ? (
        <View style={{ gap: space.xs, marginTop: space.sm }}>
          <View style={[styles.between, { flexWrap: "wrap" }]}>
            <Text style={[type.heading, { color: t.text }]}>401(k) & employer match</Text>
            <Segmented
              label="How to enter 401(k)"
              options={[{ value: "pct", label: "% of pay" }, { value: "usd", label: "$ per check" }]}
              value={inc.matchMode}
              onChange={(v) => onChange({ matchMode: v })}
            />
          </View>
          {inc.matchMode === "pct" ? (
            <>
              <FieldRow label="Gross pay per paycheck" hint="Before anything is taken out" info={HELP.gross}>
                <NumberInput kind="money" label="Gross pay per paycheck" value={inc.gross ?? 0} onChange={(v) => onChange({ gross: v })} />
              </FieldRow>
              <Divider />
              <FieldRow label="You put into your 401(k)" hint="% of gross pay" info={HELP.contribPct}>
                <NumberInput kind="percent" label="Your 401(k) percent" value={inc.contribPct ?? 0} max={1} onChange={(v) => onChange({ contribPct: v })} />
              </FieldRow>
              <Divider />
              <FieldRow label="Your employer's match" info={HELP.match} stacked>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {MATCH_PRESETS.map((m) => {
                    const on = !custom && preset?.label === m.label;
                    return (
                      <Pressable
                        key={m.label}
                        role="radio"
                        aria-checked={on}
                        onPress={() => { setCustom(false); onChange({ matchRate1: m.r1, matchUpTo1: m.u1, matchRate2: m.r2, matchUpTo2: m.u2 }); }}
                        style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }]}
                      >
                        <Text style={[type.caption, { color: on ? t.accent : t.text2, fontWeight: on ? "700" : "500" }]}>{m.label}</Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    role="radio"
                    aria-checked={custom || !preset}
                    onPress={() => setCustom(true)}
                    style={[styles.chip, { borderColor: custom || !preset ? t.accent : t.border, backgroundColor: custom || !preset ? t.accentSoft : t.surface }]}
                  >
                    <Text style={[type.caption, { color: custom || !preset ? t.accent : t.text2, fontWeight: custom || !preset ? "700" : "500" }]}>Something else</Text>
                  </Pressable>
                </View>
              </FieldRow>
              {custom || !preset ? (
                <View style={{ gap: space.sm, paddingBottom: space.sm }}>
                  <View style={styles.pair}>
                    <Text style={[type.caption, { color: t.text2 }]}>They match</Text>
                    <NumberInput kind="percent" width={92} stepper={false} label="Tier 1 match rate" value={inc.matchRate1 ?? 0} max={2} onChange={(v) => onChange({ matchRate1: v })} />
                    <Text style={[type.caption, { color: t.text2 }]}>of the first</Text>
                    <NumberInput kind="percent" width={92} stepper={false} label="Tier 1 percent of pay" value={inc.matchUpTo1 ?? 0} max={1} onChange={(v) => onChange({ matchUpTo1: v })} />
                    <Text style={[type.caption, { color: t.text2 }]}>of pay</Text>
                  </View>
                  <View style={styles.pair}>
                    <Text style={[type.caption, { color: t.text2 }]}>plus</Text>
                    <NumberInput kind="percent" width={92} stepper={false} label="Tier 2 match rate" value={inc.matchRate2 ?? 0} max={2} onChange={(v) => onChange({ matchRate2: v })} />
                    <Text style={[type.caption, { color: t.text2 }]}>of the next</Text>
                    <NumberInput kind="percent" width={92} stepper={false} label="Tier 2 percent of pay" value={inc.matchUpTo2 ?? 0} max={1} onChange={(v) => onChange({ matchUpTo2: v })} />
                    <Text style={[type.caption, { color: t.text3 }]}>(optional)</Text>
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <FieldRow label="Your 401(k) per paycheck">
                <NumberInput kind="money" label="Your 401(k) per paycheck" value={inc.pretax ?? 0} onChange={(v) => onChange({ pretax: v })} />
              </FieldRow>
              <Divider />
              <FieldRow label="Employer match per paycheck" info={HELP.match}>
                <NumberInput kind="money" label="Employer match per paycheck" value={inc.match ?? 0} onChange={(v) => onChange({ match: v })} />
              </FieldRow>
              <Divider />
              <FieldRow label="Getting the full match?">
                <Segmented
                  label="Getting the full match"
                  options={[{ value: "y", label: "Yes" }, { value: "n", label: "No" }]}
                  value={inc.fullMatch === false ? "n" : "y"}
                  onChange={(v) => onChange({ fullMatch: v === "y" })}
                />
              </FieldRow>
            </>
          )}
          {(inc.matchMode === "pct" && (inc.gross ?? 0) > 0) || inc.matchMode === "usd" ? <IncomeSummary inc={inc} marginalTax={marginalTax} /> : null}
        </View>
      ) : null}
    </Wrap>
  );
}

function Wrap({ bare, children }: { bare?: boolean; children: ReactNode }) {
  return bare ? <View style={{ gap: space.sm, padding: space.lg }}>{children}</View> : <Card style={{ gap: space.sm }}>{children}</Card>;
}

/** Buttons to add another income of a given type. */
export function AddIncomeButtons({ onAdd, hasAny }: { onAdd: (inc: Income) => void; hasAny: boolean }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: t.text2 }]}>{hasAny ? "Add another income" : "Add your income"}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {INCOME_KINDS.map((k) => (
          <Button key={k.value} title={k.label} icon="plus" onPress={() => onAdd(newIncome(k.value))} />
        ))}
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>A second job, a partner's paycheck, your own business, rental income, a pension…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { borderRadius: radius.md, padding: space.md, gap: space.xs, marginTop: space.xs },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  pair: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
});

/** Monthly average of an income, for the list and totals. */
const monthly = (inc: Income) => (inc.net * PERIODS[inc.freq]) / 12;
const KIND_LABEL: Record<IncomeKind, string> = { job: "Job", business: "Business", rental: "Rental", other: "Other income" };

/** All income sources: list on the right (pick one), its details on the left. Fills its container. */
export function IncomesEditor() {
  const t = useTheme();
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  const [selected, setSelected] = useState<string | undefined>(state.incomes[0]?.id);
  const ids = state.incomes.map((i) => i.id).join("|");
  useEffect(() => {
    if (!selected || !state.incomes.some((i) => i.id === selected)) setSelected(state.incomes[0]?.id);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const idx = Math.max(0, state.incomes.findIndex((i) => i.id === selected));
  const inc = state.incomes[idx];
  const add = (kind: IncomeKind) => {
    const n = newIncome(kind);
    update((p) => { p.incomes.push(n); });
    setSelected(n.id);
  };
  const remove = async () => {
    if (!inc) return;
    if (await confirm("Remove this income?", `"${inc.name || "This income"}" will be removed from your plan.`, "Remove")) update((p) => { p.incomes.splice(idx, 1); });
  };

  const header = (
    <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: space.sm }}>
      <View>
        <Text style={[type.caption, { color: t.text3 }]}>Take-home in a normal month</Text>
        <Text style={[type.stat, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(result.d.leanMonthly)}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[type.caption, { color: t.text3 }]}>Per year, with extra paychecks</Text>
        <Text style={[type.label, { color: t.text2, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(result.d.annualNet)}</Text>
      </View>
    </Card>
  );

  return (
    <MasterDetail
      label="Income sources"
      header={header}
      listTitle="Income sources"
      items={state.incomes.map((i) => ({ key: i.id, title: i.name, subtitle: KIND_LABEL[i.kind ?? "job"], value: `${money(monthly(i))}/mo` }))}
      selected={inc?.id}
      onSelect={setSelected}
      listFooter={
        <View style={{ gap: 6 }}>
          <Text style={[type.caption, { color: t.text3, paddingHorizontal: space.xs }]}>Add income</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {INCOME_KINDS.map((k) => (
              <Button key={k.value} title={k.label} icon="plus" onPress={() => add(k.value)} style={{ minHeight: 36, paddingHorizontal: space.md }} />
            ))}
          </View>
        </View>
      }
      chipAdd={
        <>
          {INCOME_KINDS.map((k) => <AddChip key={k.value} label={k.label} onPress={() => add(k.value)} />)}
        </>
      }
      empty={
        <>
          <Text style={[type.body, { color: t.text3 }]}>No income yet. What kind is it?</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, justifyContent: "center" }}>
            {INCOME_KINDS.map((k) => <Button key={k.value} title={k.label} icon="plus" onPress={() => add(k.value)} />)}
          </View>
        </>
      }
      detail={inc ? <IncomeEditor bare inc={inc} marginalTax={state.plan.marginalTax} onChange={(patch) => update((p) => { p.incomes[idx] = { ...p.incomes[idx]!, ...patch }; })} onRemove={remove} /> : null}
    />
  );
}
