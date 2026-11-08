import { limitsFor } from "@coastfi/engine";
import { Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { spouseIraLabel } from "../lib/spouse";
import { space, type, useTheme } from "../lib/theme";
import { Button, FieldRow, NumberInput, Segmented } from "./form";
import { Card, Divider } from "./ui";

/**
 * What you've already put in for the tax year. With it, the plan knows the exact room left (and that
 * IRA/HSA room for last year can still be filled until April 15).
 */
export function ContributionsCard() {
  const t = useTheme();
  const { state, start, actual } = usePlan();
  const update = useStore((s) => s.update);
  const thisYear = start.getFullYear();
  const beforeDeadline = start.getMonth() <= 3; // Jan–Apr: last year's IRA/HSA can still be made
  const c = state.contributed;
  const year = c && (c.year === thisYear || (beforeDeadline && c.year === thisYear - 1)) ? c.year : thisYear;
  const values = c && c.year === year ? { ...c, iraSpouse: c.iraSpouse ?? 0 } : { year, k401: 0, ira: 0, hsa: 0, iraSpouse: 0 };
  const spIra = !!state.spouse && state.accounts.some((a) => a.owner === "spouse");
  const set = (patch: Partial<typeof values>) => update((p) => { p.contributed = { ...values, ...patch, year }; });

  const L = limitsFor(state.limits, year);
  const age = state.age + (year - thisYear);
  const caps = {
    k401: L.k401 + (age >= 50 ? L.k401Catch : 0),
    ira: L.ira + (age >= 50 ? L.iraCatch : 0),
    hsa: state.plan.hsaEligible ? (state.plan.hsaFamily ? L.hsaFamily : L.hsaSelf) + (age >= 55 ? L.hsaCatch : 0) : 0,
    iraSpouse: L.ira + ((state.spouse?.age ?? 0) + (year - thisYear) >= 50 ? L.iraCatch : 0),
  };
  const left = (k: keyof typeof caps) => Math.max(0, caps[k] - values[k]);
  // nothing entered for this year: say what the plan assumes instead (earlier paychecks at today's amounts)
  const entered = !!c && c.year === year;
  const est = year === thisYear && start.getMonth() > 0 ? actual.ytdBefore : undefined;
  const hint = (k: keyof typeof caps, what: string) =>
    entered
      ? `${what} · ${money(left(k))} of ${money(caps[k])} left`
      : k === "ira" || k === "iraSpouse"
        ? `Not entered · the plan assumes nothing went in yet this year`
        : `Not entered · the plan assumes about ${money(est?.[k] ?? 0, { whole: true })} from this year's earlier paychecks`;

  return (
    <Card style={{ gap: space.sm }}>
      <Text role="heading" aria-level={2} style={[type.heading, { color: t.text }]}>Contributed so far in {year}</Text>
      <Text style={[type.caption, { color: t.text3 }]}>
        Check your 401(k) website, pay stub (year-to-date) and IRA/HSA statements. With these, the plan uses the exact room left instead of guessing
        {beforeDeadline ? "" : `, and any IRA/HSA room left for ${year} can still be filled until April 15, ${year + 1}`}.
      </Text>
      {beforeDeadline ? (
        <Segmented
          label="Tax year"
          options={[{ value: String(thisYear - 1), label: `${thisYear - 1} (until Apr 15)` }, { value: String(thisYear), label: String(thisYear) }]}
          value={String(year)}
          onChange={(v) => update((p) => { p.contributed = { year: Number(v), k401: 0, ira: 0, hsa: 0, ...(c && c.year === Number(v) ? c : null) }; })}
        />
      ) : null}
      <FieldRow label="Your 401(k)" hint={hint("k401", "Your own contributions")}>
        <NumberInput kind="money" label={`401(k) contributed in ${year}`} value={values.k401} onChange={(v) => set({ k401: v })} />
      </FieldRow>
      <Divider />
      <FieldRow label={spIra ? "Your IRA" : "IRA"} hint={hint("ira", "Traditional + Roth together")}>
        <NumberInput kind="money" label={`IRA contributed for ${year}`} value={values.ira} onChange={(v) => set({ ira: v })} />
      </FieldRow>
      {spIra ? (
        <>
          <Divider />
          <FieldRow label={spouseIraLabel(state)} hint={hint("iraSpouse", "Their own limit")}>
            <NumberInput kind="money" label={`${spouseIraLabel(state)} contributed for ${year}`} value={values.iraSpouse} onChange={(v) => set({ iraSpouse: v })} />
          </FieldRow>
        </>
      ) : null}
      {state.plan.hsaEligible ? (
        <>
          <Divider />
          <FieldRow label="HSA" hint={hint("hsa", "Yours + your employer's")}>
            <NumberInput kind="money" label={`HSA contributed for ${year}`} value={values.hsa} onChange={(v) => set({ hsa: v })} />
          </FieldRow>
        </>
      ) : null}
      {!entered ? (
        // a 0 that's right (nothing went in yet) looks the same as nothing entered: say so explicitly
        <View style={{ gap: 6 }}>
          <Button title="These are right" icon="check" tone="primary" onPress={() => set({})} style={{ alignSelf: "flex-start", minHeight: 40 }} />
          <Text style={[type.caption, { color: t.text3 }]}>Use these amounts as entered, even $0, instead of the plan&apos;s guess.</Text>
        </View>
      ) : null}
      <View>
        <Text style={[type.caption, { color: t.text3 }]}>
          Your 401(k): only what came out of your own paychecks (not the employer match). HSA: yours plus your employer&apos;s. IRA and HSA contributions for {year} can be made until April 15, {year + 1}. A 401(k) only counts what comes out of paychecks in {year}.
        </Text>
      </View>
    </Card>
  );
}
