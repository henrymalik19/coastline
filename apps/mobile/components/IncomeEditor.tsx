import { k401Cost, PAY401, PAYHSA, PERIODS, resolveIncome, type Income, type IncomeKind, type PayFreq, type PayTaxes } from "@coastfi/engine";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money, percent } from "../lib/format";
import { HELP } from "../lib/help";
import { isLoanDeduction, monthlyFromPaycheck } from "../lib/loans";
import { DEDUCTION_KINDS, paycheck, withAutoNet } from "../lib/paycheck";
import { MATCH_PRESETS } from "../lib/presets";
import { estimatePaycheckTaxes, FILING_LABELS } from "../lib/tax";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, DateField, FieldRow, IconButton, NumberInput, Segmented, Select, TextField, ToggleRow } from "./form";
import { Icon } from "./Icon";

const HSA_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
import { AddChip, MasterDetail } from "./MasterDetail";
import { Card, Divider } from "./ui";
import { PaycheckChanges } from "./ScheduleEditor";
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
    ? { id: newId(), name, kind, freq: "biweekly", net: 0, netMode: "auto", matchMode: "pct", gross: 0, contribPct: 0.04, matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02, taxes: { federal: 0, state: 0, socialSecurity: 0, medicare: 0 }, deductions: [] }
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
            (about {money(r.gapPre * k401Cost(marginalTax, inc.rothShare))} less take-home) for <Text style={{ fontWeight: "700" }}>+{money(r.gapMatch * P)}/yr</Text> of free money.
          </Text>
        )
      ) : !good ? (
        <Text style={[type.caption, { color: t.bad }]}>Not getting the full match. Switch to "% of pay" so the plan can work out the gap.</Text>
      ) : null}
    </View>
  );
}

/** One income source. Jobs: gross pay, then deductions like a pay stub, then take-home (calculated or typed). */
export function IncomeEditor({
  inc, onChange, onRemove, marginalTax, bare,
}: { inc: Income; onChange: (patch: Partial<Income>) => void; onRemove?: () => void; marginalTax: number; /** No card around it (inside a pane). */ bare?: boolean }) {
  const t = useTheme();
  const kind = inc.kind ?? "job";
  const isJob = kind === "job";
  const auto = isJob && inc.netMode === "auto";
  const { estimate } = useTaxEstimate(inc.id);
  // every change to a job in auto mode recalculates take-home; taxes that are still the estimate follow
  const change = (patch: Partial<Income>) => {
    const next = { ...inc, ...patch };
    const follow = auto && !("taxes" in patch) && (next.kind ?? "job") === "job" && (next.gross ?? 0) > 0 && taxesFollowEstimate(inc, estimate);
    onChange(withAutoNet(inc, follow ? { ...patch, taxes: estimate(next) } : patch));
  };
  const amountHelp = kind === "business" ? HELP.businessAmount : kind === "rental" ? HELP.rentalAmount : HELP.otherAmount;

  return (
    <Wrap bare={bare}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField label="Income name" placeholder="e.g. Acme Corp" value={inc.name} onChange={(v) => change({ name: v })} />
        </View>
        {onRemove ? <IconButton icon="trash" color={t.bad} label={`Remove ${inc.name || "this income"}`} onPress={onRemove} /> : null}
      </View>
      <Segmented
        label="Type of income"
        options={INCOME_KINDS.map((k) => ({ value: k.value, label: k.label }))}
        value={kind}
        onChange={(v) => change(v === "job" ? { kind: v, matchMode: "pct", netMode: "auto" } : { kind: v, ...NON_JOB })}
      />

      <View style={{ gap: space.xs, marginTop: space.xs }}>
        <Text style={[type.label, { color: t.text2 }]}>{isJob ? "How often are you paid?" : "How often does it come in?"}</Text>
        <Segmented label="Frequency" options={FREQS} value={inc.freq} onChange={(v) => change({ freq: v })} />
      </View>
      {inc.freq === "weekly" || inc.freq === "biweekly" ? (
        <FieldRow label={isJob ? "Next payday" : "Next payment date"} hint="Finds your 3-paycheck months" info={HELP.nextPayday}>
          <DateField label="Next payday" value={inc.nextPayday} onChange={(v) => change({ nextPayday: v })} />
        </FieldRow>
      ) : null}

      {isJob ? (
        <JobPay inc={inc} auto={auto} change={change} marginalTax={marginalTax} />
      ) : (
        <FieldRow label={`Amount you keep ${inc.freq === "monthly" ? "per month" : "each time"}`} hint="After taxes and costs" info={amountHelp}>
          <NumberInput kind="money" label="Amount you keep" value={inc.net} onChange={(v) => change({ net: v })} />
        </FieldRow>
      )}
      {kind === "rental" ? <RentalValue inc={inc} /> : null}
    </Wrap>
  );
}

/** A rental's worth, kept as a Property account (same id every time) so it shows in net worth. */
export const rentalAccountId = (incomeId: string) => `prop-${incomeId}`;

function RentalValue({ inc }: { inc: Income }) {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const id = rentalAccountId(inc.id);
  const account = state.accounts.find((a) => a.id === id);
  const setValue = (v: number) =>
    update((p) => {
      const a = p.accounts.find((x) => x.id === id);
      if (a) a.balance = v;
      else if (v > 0) p.accounts.push({ id, name: inc.name.trim() || "Rental property", type: "property", balance: v });
    });
  return (
    <View style={{ gap: 2 }}>
      <FieldRow label="What the property is worth" hint="Roughly what it would sell for. Counts in your net worth" info={HELP.property}>
        <NumberInput kind="money" label="Rental property value" value={account?.balance ?? 0} onChange={setValue} />
      </FieldRow>
      <Text style={[type.caption, { color: t.text3 }]}>
        It's listed under Accounts as a property. Add its mortgage under Debts so net worth subtracts what you owe.
      </Text>
    </View>
  );
}

/** Estimated taxes for one paycheck of a job (the other jobs in the plan share the tax return). */
function useTaxEstimate(id: string) {
  const { state } = usePlan();
  const status = state.filingStatus ?? "single";
  const otherJobs = state.incomes
    .filter((j) => j.id !== id && (j.kind ?? "job") === "job" && (j.gross ?? 0) > 0)
    .map((j) => {
      const p = paycheck(j);
      return { gross: p.gross * PERIODS[j.freq], pretax: (p.k401Pretax + p.pretaxDeductions) * PERIODS[j.freq] };
    });
  const estimate = (inc: Income): PayTaxes => {
    const p = paycheck(inc);
    return estimatePaycheckTaxes(inc.gross ?? 0, PERIODS[inc.freq], p.k401Pretax + p.pretaxDeductions, status, otherJobs);
  };
  return { estimate, status, otherJobs: otherJobs.length };
}

const TAX_KEYS = ["federal", "state", "socialSecurity", "medicare"] as const;
/** Paychecks in a month without an extra one (matches "Take-home in a normal month"). */
const CHECKS_IN_NORMAL_MONTH: Record<PayFreq, number> = { weekly: 4, biweekly: 2, semimonthly: 2, monthly: 1 };
/** 4% rather than 4.00%; 4.5% keeps its decimal. */
const pctShort = (x: number) => percent(x, Math.round(x * 10000) % 100 === 0 ? 0 : 2);
const taxTotal = (x: PayTaxes) => TAX_KEYS.reduce((s, k) => s + (x[k] ?? 0), 0);
const sameTaxes = (a: PayTaxes, b: PayTaxes) => TAX_KEYS.every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.01);

/**
 * True while a job's taxes are still the estimate (or empty): then they follow pay changes, so
 * nobody has to press "estimate" again after changing their pay or 401(k).
 */
function taxesFollowEstimate(inc: Income, estimate: (i: Income) => PayTaxes): boolean {
  const taxes = inc.taxes ?? { federal: 0, state: 0, socialSecurity: 0, medicare: 0 };
  return taxTotal(taxes) === 0 || ((inc.gross ?? 0) > 0 && sameTaxes(taxes, estimate(inc)));
}

/** A part of the paycheck that opens to fill in; closed, it shows a one-line summary. */
function PaySection({
  title, summary, attention, open, onToggle, children,
}: { title: string; summary: string; attention?: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.group, { borderColor: attention && !open ? t.warn : t.border }]}>
      <Pressable
        role="button"
        aria-expanded={open}
        accessibilityLabel={`${title}: ${summary}`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={[styles.between, { minHeight: 40 }]}
      >
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <Icon name="chevron" size={18} color={t.text3} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[type.heading, { color: t.text }]}>{title}</Text>
          <Text numberOfLines={open ? undefined : 2} style={[type.caption, { color: attention ? t.warn : t.text3 }]}>{summary}</Text>
        </View>
      </Pressable>
      {open ? <View style={{ gap: 2, marginTop: space.xs }}>{children}</View> : null}
    </View>
  );
}

/** Gross pay and take-home first; then each thing that comes out of the check, one section at a time. */
function JobPay({ inc, auto, change, marginalTax }: { inc: Income; auto: boolean; change: (p: Partial<Income>) => void; marginalTax: number }) {
  const t = useTheme();
  const [custom, setCustom] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k));
  const { state } = usePlan();
  const { estimate, status, otherJobs } = useTaxEstimate(inc.id);
  const pay = paycheck(inc);
  const P = PERIODS[inc.freq];
  const r = resolveIncome(inc);
  const taxes = inc.taxes ?? { federal: 0, state: 0, socialSecurity: 0, medicare: 0 };
  const setTax = (k: keyof PayTaxes, v: number) => change({ taxes: { ...taxes, [k]: v } });
  const estimated = (inc.gross ?? 0) > 0 && taxTotal(taxes) > 0 && sameTaxes(taxes, estimate(inc));
  const deductions = inc.deductions ?? [];
  const others = deductions.filter((x) => !isLoanDeduction(x));
  const loan = deductions.find(isLoanDeduction);
  const preset = MATCH_PRESETS.find(
    (m) => (inc.matchRate1 ?? 0) === m.r1 && (inc.matchUpTo1 ?? 0) === m.u1 && (inc.matchRate2 ?? 0) === m.r2 && (inc.matchUpTo2 ?? 0) === m.u2,
  );
  const hasGross = (inc.gross ?? 0) > 0;

  const k401Summary =
    r.pretax <= 0
      ? r.match > 0 || (inc.matchMode === "pct" && (inc.matchRate1 ?? 0) > 0)
        ? "Nothing yet. Your employer offers a match"
        : "Not contributing"
      : `${inc.matchMode === "pct" ? `${pctShort(inc.contribPct ?? 0)} · ` : ""}${money(r.pretax)}/check` +
        (r.match > 0 ? ` · employer adds ${money(r.match)}` : "") +
        (inc.matchMode === "pct" && hasGross && !r.fullMatch ? " · missing part of the match" : r.match > 0 ? " · full match" : "") +
        ((inc.rothShare ?? 0) > 0 ? ` · ${Math.round((inc.rothShare ?? 0) * 100)}% Roth` : "") +
        (loan ? " · repaying a loan" : "");
  const k401Attention = inc.matchMode === "pct" && hasGross && !r.fullMatch;
  const hsaSummary =
    (inc.hsaPre ?? 0) > 0 || (inc.hsaEmployer ?? 0) > 0
      ? [(inc.hsaPre ?? 0) > 0 ? `${money(inc.hsaPre ?? 0)}/check` : "", (inc.hsaEmployer ?? 0) > 0 ? `employer adds ${money(inc.hsaEmployer ?? 0)}/yr` : ""].filter(Boolean).join(" · ")
      : "None";
  const taxSummary = !hasGross ? "Enter your gross pay first" : taxTotal(taxes) === 0 ? "Not added yet" : `${money(taxTotal(taxes))}/check${estimated ? " (estimate)" : ""}`;
  const otherSummary = others.length
    ? `${money(others.reduce((s, x) => s + x.amount, 0))}/check · ${others.map((x) => DEDUCTION_KINDS.find((k) => k.value === x.kind)?.label ?? "Other").join(", ")}`
    : "Health insurance, dental, union dues…";

  return (
    <View style={{ gap: space.xs }}>
      <FieldRow label="Gross pay per paycheck" hint="Before anything is taken out" info={HELP.gross}>
        <NumberInput kind="money" label="Gross pay per paycheck" value={inc.gross ?? 0} onChange={(v) => change({ gross: v })} />
      </FieldRow>

      {/* the result, right under the pay it comes from */}
      <View style={[styles.result, { backgroundColor: auto && pay.taxes === 0 && pay.gross > 0 ? t.warnSoft : t.accentSoft }]}>
        <View style={styles.between}>
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: t.text2 }]}>Take-home per paycheck</Text>
            <Text style={[type.caption, { color: t.text3 }]}>
              {auto
                ? hasGross
                  ? `${money(inc.net * CHECKS_IN_NORMAL_MONTH[inc.freq])} in a normal month${CHECKS_IN_NORMAL_MONTH[inc.freq] > 1 ? ` (${CHECKS_IN_NORMAL_MONTH[inc.freq]} paychecks)` : ""}`
                  : "Worked out from your pay and what comes out of it"
                : "Typed from your pay stub"}
            </Text>
          </View>
          {auto ? (
            <Text style={[type.stat, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(inc.net)}</Text>
          ) : (
            <NumberInput kind="money" label="Take-home per paycheck" value={inc.net} onChange={(v) => change({ net: v })} />
          )}
        </View>
        {auto && pay.gross > 0 ? (
          <Text style={[type.caption, { color: t.text3 }]}>
            {money(pay.gross)} − {money(pay.k401)} 401(k){pay.hsa > 0 ? ` − ${money(pay.hsa)} HSA` : ""} − {money(pay.taxes)} taxes
            {pay.deductions > 0 ? ` − ${money(pay.deductions)} other` : ""}
            {pay.loanRepayment > 0 ? ` − ${money(pay.loanRepayment)} 401(k) loan` : ""}
          </Text>
        ) : null}
        <ToggleRow
          label="Type take-home from my pay stub instead"
          hint="Skip taxes and other deductions"
          value={!auto}
          onChange={(manual) => change(manual ? { netMode: "manual" } : { netMode: "auto" })}
        />
      </View>

      <Text style={[type.overline, { color: t.text3, marginTop: space.md }]}>What comes out of each paycheck</Text>
      <Text style={[type.caption, { color: t.text3 }]}>Tap one to fill it in. Rough numbers are fine; a pay stub has the exact ones.</Text>

      <PaySection title="401(k)" summary={k401Summary} attention={k401Attention} open={open === "k401"} onToggle={() => toggle("k401")}>
        <Segmented
          label="How to enter 401(k)"
          options={[{ value: "pct", label: "% of pay" }, { value: "usd", label: "$ per check" }]}
          value={inc.matchMode}
          onChange={(v) => change({ matchMode: v })}
        />
        {inc.matchMode === "pct" ? (
          <>
            <FieldRow label="You put in" hint={hasGross ? `${money(pay.k401)} per check` : "% of gross pay"} info={HELP.contribPct}>
              <NumberInput kind="percent" label="Your 401(k) percent" value={inc.contribPct ?? 0} max={1} onChange={(v) => change({ contribPct: v })} />
            </FieldRow>
            <FieldRow label="Your employer's match" info={HELP.match} stacked>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {MATCH_PRESETS.map((m) => {
                  const on = !custom && preset?.label === m.label;
                  return (
                    <Pressable
                      key={m.label}
                      role="radio"
                      aria-checked={on}
                      onPress={() => { setCustom(false); change({ matchRate1: m.r1, matchUpTo1: m.u1, matchRate2: m.r2, matchUpTo2: m.u2 }); }}
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
                  <NumberInput kind="percent" width={92} stepper={false} label="Tier 1 match rate" value={inc.matchRate1 ?? 0} max={2} onChange={(v) => change({ matchRate1: v })} />
                  <Text style={[type.caption, { color: t.text2 }]}>of the first</Text>
                  <NumberInput kind="percent" width={92} stepper={false} label="Tier 1 percent of pay" value={inc.matchUpTo1 ?? 0} max={1} onChange={(v) => change({ matchUpTo1: v })} />
                  <Text style={[type.caption, { color: t.text2 }]}>of pay</Text>
                </View>
                <View style={styles.pair}>
                  <Text style={[type.caption, { color: t.text2 }]}>plus</Text>
                  <NumberInput kind="percent" width={92} stepper={false} label="Tier 2 match rate" value={inc.matchRate2 ?? 0} max={2} onChange={(v) => change({ matchRate2: v })} />
                  <Text style={[type.caption, { color: t.text2 }]}>of the next</Text>
                  <NumberInput kind="percent" width={92} stepper={false} label="Tier 2 percent of pay" value={inc.matchUpTo2 ?? 0} max={1} onChange={(v) => change({ matchUpTo2: v })} />
                  <Text style={[type.caption, { color: t.text3 }]}>(optional)</Text>
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <FieldRow label="You put in per paycheck" info={HELP.contribPct}>
              <NumberInput kind="money" label="Your 401(k) per paycheck" value={inc.pretax ?? 0} onChange={(v) => change({ pretax: v })} />
            </FieldRow>
            <FieldRow label="Employer match per paycheck" info={HELP.match}>
              <NumberInput kind="money" label="Employer match per paycheck" value={inc.match ?? 0} onChange={(v) => change({ match: v })} />
            </FieldRow>
            <FieldRow label="Getting the full match?">
              <Segmented
                label="Getting the full match"
                options={[{ value: "y", label: "Yes" }, { value: "n", label: "No" }]}
                value={inc.fullMatch === false ? "n" : "y"}
                onChange={(v) => change({ fullMatch: v === "y" })}
              />
            </FieldRow>
          </>
        )}
        {(inc.matchMode === "pct" && hasGross) || inc.matchMode === "usd" ? <IncomeSummary inc={inc} marginalTax={marginalTax} /> : null}
        {r.pretax > 0 || (state.plan.schedule?.[PAY401 + inc.id]?.length ?? 0) > 0 ? (
          <PaycheckChanges k={PAY401 + inc.id} label={`${inc.name || "This job"} 401(k)`} base={r.pretax} gross={inc.gross} />
        ) : null}
        <FieldRow label="Roth 401(k)" hint={rothHint(inc.rothShare ?? 0)} info={HELP.roth401k}>
          <NumberInput kind="percent" label="Share of your 401(k) that goes to Roth" value={inc.rothShare ?? 0} max={1} onChange={(v) => change({ rothShare: v || undefined })} />
        </FieldRow>
        <LoanFields inc={inc} change={change} />
      </PaySection>

      {auto ? (
        <PaySection title="Taxes" summary={taxSummary} attention={hasGross && taxTotal(taxes) === 0} open={open === "tax"} onToggle={() => toggle("tax")}>
          <Text style={[type.caption, { color: t.text3 }]}>
            {estimated
              ? "Estimated from your pay, and kept up to date when your pay changes. For exact numbers, copy them from a pay stub."
              : "Per paycheck, from a pay stub."}{" "}
            The estimate uses {FILING_LABELS[status].toLowerCase()} (change it in About you){otherJobs ? ", counts your other job income on the same return," : ""} and about 4% state tax.
          </Text>
          {TAX_KEYS.map((k) => (
            <FieldRow key={k} label={TAX_LABELS[k]}>
              <NumberInput kind="money" label={TAX_LABELS[k]} value={taxes[k]} onChange={(v) => setTax(k, v)} />
            </FieldRow>
          ))}
          {!estimated && hasGross ? (
            <Button title="Use the estimate instead" tone="ghost" onPress={() => change({ taxes: estimate(inc) })} style={{ alignSelf: "flex-start" }} />
          ) : null}
        </PaySection>
      ) : null}

      <PaySection title="HSA" summary={hsaSummary} open={open === "hsa"} onToggle={() => toggle("hsa")}>
        <FieldRow label="You put in per paycheck" hint="Your own HSA contribution, pre-tax. Counts toward the HSA limit">
          <NumberInput kind="money" label="Your HSA contribution per paycheck" value={inc.hsaPre ?? 0} onChange={(v) => change({ hsaPre: v || undefined })} />
        </FieldRow>
        {(inc.hsaPre ?? 0) > 0 || (state.plan.schedule?.[PAYHSA + inc.id]?.length ?? 0) > 0 ? (
          <PaycheckChanges k={PAYHSA + inc.id} label={`${inc.name || "This job"} HSA`} base={inc.hsaPre ?? 0} gross={inc.gross} />
        ) : null}
        <FieldRow label="Your employer puts in" hint="Per year. Free money that counts toward your HSA limit" info={HELP.hsaEmployer}>
          <NumberInput kind="money" label="Employer HSA contribution per year" value={inc.hsaEmployer ?? 0} onChange={(v) => change({ hsaEmployer: v || undefined })} />
        </FieldRow>
        {(inc.hsaEmployer ?? 0) > 0 ? (
          <FieldRow
            label="It comes"
            hint={inc.hsaEmployerMonth ? `All ${money(inc.hsaEmployer ?? 0)} at once, in ${HSA_MONTHS[inc.hsaEmployerMonth - 1]}` : `${money((inc.hsaEmployer ?? 0) / 12)} a month`}
          >
            <View style={{ gap: space.sm }}>
              <Segmented
                label="How your employer's HSA money comes"
                options={[{ value: "monthly", label: "Spread over the year" }, { value: "lump", label: "Once a year" }]}
                value={inc.hsaEmployerMonth ? "lump" : "monthly"}
                onChange={(v) => change({ hsaEmployerMonth: v === "lump" ? 1 : undefined })}
              />
              {inc.hsaEmployerMonth ? (
                <Select
                  label="Month it comes"
                  options={HSA_MONTHS.map((n, i) => ({ value: String(i + 1), label: n }))}
                  value={String(inc.hsaEmployerMonth)}
                  onChange={(v) => change({ hsaEmployerMonth: Number(v) })}
                />
              ) : null}
            </View>
          </FieldRow>
        ) : null}
        {((inc.hsaEmployer ?? 0) > 0 || (inc.hsaPre ?? 0) > 0) && !state.plan.hsaEligible ? (
          <Text style={[type.caption, { color: t.warn }]}>
            Turn on "I have an HSA-eligible health plan" in Settings → Assumptions & plan rules so your plan can add to it too.
          </Text>
        ) : null}
      </PaySection>

      {auto ? (
        <PaySection title="Other deductions" summary={otherSummary} open={open === "other"} onToggle={() => toggle("other")}>
          {deductions.map((x, i) => {
            if (isLoanDeduction(x)) return null; // shown in the 401(k) section
            const label = DEDUCTION_KINDS.find((k) => k.value === x.kind)?.label ?? "Other";
            return (
              <View key={x.id} style={styles.dedRow}>
                <Text style={[type.body, { color: t.text, flex: 1 }]}>{label}</Text>
                <NumberInput
                  kind="money"
                  label={`${label} per paycheck`}
                  value={x.amount}
                  onChange={(v) => change({ deductions: deductions.map((d, j) => (j === i ? { ...d, amount: v } : d)) })}
                />
                <IconButton icon="trash" color={t.bad} label={`Remove ${label}`} onPress={() => change({ deductions: deductions.filter((_, j) => j !== i) })} />
              </View>
            );
          })}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {DEDUCTION_KINDS.filter((k) => k.value !== "k401_loan" && (k.value === "other" || !deductions.some((d) => d.kind === k.value))).map((k) => (
              <Pressable
                key={k.value}
                role="button"
                accessibilityLabel={`Add ${k.label}`}
                onPress={() => change({ deductions: [...deductions, { id: newId(), kind: k.value, amount: 0 }] })}
                style={[styles.chip, { borderColor: t.border, borderStyle: "dashed", backgroundColor: t.surface }]}
              >
                <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>+ {k.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>HSA contributions go in the HSA section: they're savings, and your plan's HSA step handles them.</Text>
        </PaySection>
      ) : null}
    </View>
  );
}

const TAX_LABELS: Record<(typeof TAX_KEYS)[number], string> = {
  federal: "Federal income tax",
  state: "State income tax",
  socialSecurity: "Social Security",
  medicare: "Medicare",
};

/** "Repaying a 401(k) loan?" switch; when on, the per-check repayment plus the loan's balance and rate (kept on its debt). */
function LoanFields({ inc, change }: { inc: Income; change: (p: Partial<Income>) => void }) {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const deductions = inc.deductions ?? [];
  const loan = deductions.find(isLoanDeduction);
  const debt = loan?.debtId ? state.debts.find((d) => d.id === loan.debtId) : undefined;
  const setDebt = (patch: { balance?: number; apr?: number }) =>
    update((p) => {
      const d = p.debts.find((x) => x.id === loan?.debtId);
      if (d) Object.assign(d, patch);
    });
  const turnOff = async () => {
    if (debt && debt.balance > 0 && !(await confirm("Remove the 401(k) loan?", "This also removes it from your debts.", "Remove"))) return;
    update((p) => {
      p.debts = p.debts.filter((d) => d.id !== loan?.debtId);
      const i = p.incomes.findIndex((x) => x.id === inc.id);
      if (i >= 0) p.incomes[i]!.deductions = (p.incomes[i]!.deductions ?? []).filter((d) => !isLoanDeduction(d));
    });
  };
  return (
    <View style={{ gap: space.xs }}>
      <ToggleRow
        label="I'm repaying a 401(k) loan"
        hint="Repayments come out of your paycheck after tax"
        value={!!loan}
        onChange={(on) => (on ? change({ deductions: [...deductions, { id: newId(), kind: "k401_loan", amount: 0 }] }) : void turnOff())}
      />
      {loan ? (
        <View style={[styles.loan, { backgroundColor: t.surface2 }]}>
          <FieldRow label="Repayment per paycheck" hint={loan.amount > 0 ? `About ${money(monthlyFromPaycheck(loan.amount, inc))} a month` : "From your pay stub"}>
            <NumberInput
              kind="money"
              label="401(k) loan repayment per paycheck"
              value={loan.amount}
              onChange={(v) => change({ deductions: deductions.map((d) => (d.id === loan.id ? { ...d, amount: v } : d)) })}
            />
          </FieldRow>
          {debt ? (
            <>
              <FieldRow label="Loan balance" hint="What you still owe">
                <NumberInput kind="money" label="401(k) loan balance" value={debt.balance} onChange={(v) => setDebt({ balance: v })} />
              </FieldRow>
              <FieldRow label="Interest rate" hint="From your loan statement">
                <NumberInput kind="percent" label="401(k) loan interest rate" value={debt.apr} max={1} onChange={(v) => setDebt({ apr: v })} />
              </FieldRow>
            </>
          ) : null}
          <Text style={[type.caption, { color: t.text3 }]}>
            It comes out of your take-home like on your pay stub, and shows under Debts so the plan tracks the balance. Don't add it to your budget. The interest goes back into your own 401(k), so the plan doesn't rush to pay it off.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const rothHint = (share: number) =>
  share <= 0 ? "Share that goes to Roth. 0% = all pre-tax" : share >= 1 ? "All Roth: taxed now, tax-free in retirement" : `${Math.round(share * 100)}% Roth, ${Math.round((1 - share) * 100)}% pre-tax`;

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
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space.md, gap: 2, marginTop: space.xs },
  loan: { borderRadius: radius.sm, padding: space.md, gap: space.xs },
  dedRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52 },
  result: { borderRadius: radius.md, padding: space.md, gap: space.xs, marginTop: space.sm },
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
    const hasProperty = state.accounts.some((a) => a.id === rentalAccountId(inc.id));
    const msg = `"${inc.name || "This income"}" will be removed from your plan${hasProperty ? ", along with its property value in Accounts" : ""}.`;
    if (await confirm("Remove this income?", msg, "Remove"))
      update((p) => {
        p.incomes.splice(idx, 1);
        p.accounts = p.accounts.filter((a) => a.id !== rentalAccountId(inc.id));
      });
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
      detail={inc ? <IncomeEditor key={inc.id} bare inc={inc} marginalTax={state.plan.marginalTax} onChange={(patch) => update((p) => { p.incomes[idx] = { ...p.incomes[idx]!, ...patch }; })} onRemove={remove} /> : null}
    />
  );
}
