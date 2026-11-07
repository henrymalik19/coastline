import { PERIODS, type Debt, type DebtKind, type PlanState } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DEBT_KINDS, debtKind, debtLabel } from "../lib/debts";
import { money, percent } from "../lib/format";
import { Icon } from "./Icon";
import { HELP } from "../lib/help";
import { paycheckFor } from "../lib/loans";
import { usePlan } from "../lib/plan";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, FieldRow, IconButton, MonthField, NumberInput, TextField, ToggleRow } from "./form";
import { Card, Divider } from "./ui";

/** The paycheck that repays a debt, in the shape DebtEditor's `paidFrom` wants. */
export function paidFromFor(state: PlanState, debtId: string) {
  const link = paycheckFor(state, debtId);
  return link ? { job: link.income.name || "job", perCheck: link.deduction.amount } : undefined;
}

/** Debt types that can have an intro / promo rate. */
const PROMO_KINDS = new Set<DebtKind>(["credit_card", "personal", "car", "other"]);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "YYYY-MM" n months from now (a UI default only; the engine never reads the clock). */
function monthsFromNow(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const shortMonth = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const pct = (v: number) => percent(v, 1).replace(/\.0%$/, "%");

export function newDebt(kind: DebtKind): Debt {
  return { id: newId(), name: "", kind, balance: 0, apr: debtKind(kind).typicalApr, minPayment: 0 };
}

/** One debt: pick a type, optionally name it, then balance / rate / minimum. */
export function DebtEditor({
  debt, onChange, onRemove, paidFrom,
}: {
  debt: Debt; onChange: (patch: Partial<Debt>) => void; onRemove: () => void;
  /** Set when a paycheck repays this debt (a 401(k) loan): its payment comes from there. */
  paidFrom?: { job: string; perCheck: number };
}) {
  const t = useTheme();
  const kind = debtKind(debt.kind);
  const setKind = (k: DebtKind) => {
    // swap in the new type's typical rate only if the rate is still the old default
    const keepApr = debt.apr !== kind.typicalApr && debt.apr !== 0;
    onChange({ kind: k, ...(keepApr ? {} : { apr: debtKind(k).typicalApr }) });
  };
  // filled-in debts start collapsed (one line each); a new, blank one opens to fill in
  const [open, setOpen] = useState(() => !debt.name && !debt.balance && !debt.minPayment);
  return (
    <Card style={{ gap: space.sm, paddingVertical: open ? space.lg : space.md }}>
      <View style={styles.between}>
        <Pressable
          role="button"
          aria-expanded={open}
          accessibilityLabel={`${debtLabel(debt)} details`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((o) => !o)}
          style={[styles.between, { flex: 1, minHeight: 32 }]}
        >
          <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
            <Icon name="chevron" size={18} color={t.text3} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={[type.heading, { color: t.text }]} numberOfLines={1}>{debtLabel(debt)}</Text>
            {!open ? (
              <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
                {money(debt.balance)} · {debt.promoUntil ? `${pct(debt.promoApr ?? 0)} until ${shortMonth(debt.promoUntil)}, then ${pct(debt.apr)}` : pct(debt.apr)} ·{" "}
                {paidFrom ? `${money(paidFrom.perCheck)}/paycheck` : `${money(debt.minPayment)}/mo`}{debt.minimumOnly ? " · minimum only" : ""}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <IconButton icon="trash" color={t.bad} label={`Remove ${debtLabel(debt)}`} onPress={onRemove} />
      </View>
      {open ? (
        <>
      <View role="radiogroup" aria-label="Type of debt" style={styles.chips}>
        {DEBT_KINDS.map((k) => {
          const on = k.value === kind.value;
          return (
            <Pressable
              key={k.value}
              role="radio"
              aria-checked={on}
              onPress={() => setKind(k.value)}
              style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }]}
            >
              <Text style={[type.caption, { color: on ? t.accent : t.text2, fontWeight: on ? "700" : "500" }]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldRow label="Name" hint="Optional, to tell debts apart">
        <TextField width={220} label="Debt name (optional)" placeholder={kind.placeholder} value={debt.name} onChange={(v) => onChange({ name: v })} />
      </FieldRow>
      <Divider />
      <FieldRow label="Balance" hint="What you still owe">
        <NumberInput kind="money" label={`${debtLabel(debt)} balance`} value={debt.balance} onChange={(v) => onChange({ balance: v })} />
      </FieldRow>
      <Divider />
      <FieldRow label="Interest rate (APR)" hint={`Typical ${kind.label.toLowerCase()}: ${(kind.typicalApr * 100).toFixed(1).replace(/\.0$/, "")}%. Use yours.`} info={HELP.apr}>
        <NumberInput kind="percent" label={`${debtLabel(debt)} APR`} value={debt.apr} max={1} onChange={(v) => onChange({ apr: v })} />
      </FieldRow>
      <Divider />
      {paidFrom || kind.value === "k401_loan" ? (
        <PaycheckLoanPayment debt={debt} />
      ) : (
        <FieldRow label="Minimum payment" hint="Per month" info={HELP.minPayment}>
          <NumberInput kind="money" label={`${debtLabel(debt)} minimum payment`} value={debt.minPayment} onChange={(v) => onChange({ minPayment: v })} />
        </FieldRow>
      )}
      {PROMO_KINDS.has(kind.value) ? (
        <>
          <Divider />
          <ToggleRow
            label="Intro rate (like 0% APR)"
            hint="A promo or balance-transfer rate that ends on a set date"
            value={debt.promoUntil !== undefined}
            onChange={(on) => onChange(on ? { promoApr: 0, promoUntil: monthsFromNow(12) } : { promoApr: undefined, promoUntil: undefined })}
          />
          {debt.promoUntil !== undefined ? (
            <View style={[styles.sub, { backgroundColor: t.surface2 }]}>
              <FieldRow label="Intro rate">
                <NumberInput kind="percent" label={`${debtLabel(debt)} intro rate`} value={debt.promoApr ?? 0} max={1} onChange={(v) => onChange({ promoApr: v })} />
              </FieldRow>
              <FieldRow label="Last month at the intro rate" hint={`Then ${percent(debt.apr, 1).replace(/\.0%$/, "%")} (the rate above). The plan pays it off before then when it can.`}>
                <MonthField label={`${debtLabel(debt)} intro rate ends`} value={debt.promoUntil} onChange={(v) => onChange({ promoUntil: v })} />
              </FieldRow>
            </View>
          ) : null}
        </>
      ) : null}
      {kind.value === "student" ? (
        <>
          <Divider />
          <ToggleRow
            label="On income-driven repayment or PSLF"
            hint="The plan pays only the minimum and never extra, since the rest may be forgiven"
            value={!!debt.minimumOnly}
            onChange={(on) => onChange({ minimumOnly: on || undefined })}
          />
        </>
      ) : null}
      {kind.note && !paidFrom ? (
        <View style={[styles.note, { backgroundColor: t.warnSoft }]}>
          <Text style={[type.caption, { color: t.text }]}>{kind.note}</Text>
        </View>
      ) : null}
        </>
      ) : null}
    </Card>
  );
}

/**
 * A 401(k) loan's payment, per paycheck. Linked to a job: edit the per-check amount here (or under
 * Income); the monthly payment follows. Not linked yet: pick the job it's repaid from, or type a
 * monthly amount if it isn't repaid from a paycheck.
 */
function PaycheckLoanPayment({ debt }: { debt: Debt }) {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const link = paycheckFor(state, debt.id);
  const jobs = state.incomes.filter((i) => (i.kind ?? "job") === "job");

  if (link) {
    const { income, deduction } = link;
    const P = PERIODS[income.freq];
    const setPerCheck = (v: number) =>
      update((p) => {
        const d = p.incomes.find((x) => x.id === income.id)?.deductions?.find((x) => x.id === deduction.id);
        if (d) d.amount = v;
      });
    return (
      <FieldRow label="Repayment per paycheck" hint={`From your ${income.name || "job"} paycheck, ${P} a year · about ${money(debt.minPayment)}/mo`}>
        <NumberInput kind="money" label={`${debtLabel(debt)} repayment per paycheck`} value={deduction.amount} onChange={setPerCheck} />
      </FieldRow>
    );
  }

  const linkTo = (incomeId: string) =>
    update((p) => {
      const inc = p.incomes.find((x) => x.id === incomeId);
      if (!inc) return;
      // carry over a monthly amount already typed, as the matching per-check amount
      const perCheck = Math.round(((debt.minPayment * 12) / PERIODS[inc.freq]) * 100) / 100;
      inc.deductions = [...(inc.deductions ?? []), { id: newId(), kind: "k401_loan", amount: perCheck, debtId: debt.id }];
    });
  return (
    <View style={{ gap: space.sm }}>
      {jobs.length ? (
        <FieldRow label="Repaid from" hint="Pick the paycheck it comes out of, then enter the amount per paycheck" stacked>
          <View style={styles.chips}>
            {jobs.map((j) => (
              <Button key={j.id} title={`${j.name || "Job"} paycheck`} onPress={() => linkTo(j.id)} style={{ minHeight: 36, paddingHorizontal: space.md }} />
            ))}
          </View>
        </FieldRow>
      ) : null}
      <FieldRow label={jobs.length ? "Or a monthly payment" : "Payment per month"} hint={jobs.length ? "If it isn't repaid from a paycheck" : "Add your job under Income to enter it per paycheck"}>
        <NumberInput kind="money" label={`${debtLabel(debt)} payment per month`} value={debt.minPayment} onChange={(v) => update((p) => { const d = p.debts.find((x) => x.id === debt.id); if (d) d.minPayment = v; })} />
      </FieldRow>
      <Text style={[type.caption, { color: t.text3 }]}>Don't also add it as a budget item.</Text>
    </View>
  );
}

/** "Add a debt" as one button per type. */
export function AddDebtButtons({ onAdd, hasAny }: { onAdd: (d: Debt) => void; hasAny: boolean }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: t.text2 }]}>{hasAny ? "Add another debt" : "Add a debt"}</Text>
      <View style={styles.chips}>
        {DEBT_KINDS.map((k) => (
          <Button key={k.value} title={k.label} icon="plus" onPress={() => onAdd(newDebt(k.value))} style={{ minHeight: 36, paddingHorizontal: space.md }} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 7, minHeight: 34, justifyContent: "center" },
  note: { borderRadius: radius.sm, padding: space.md },
  sub: { borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.xs },
});
