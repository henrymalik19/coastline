import { limitsFor } from "@coastfi/engine";
import { Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { FieldRow, NumberInput, Segmented } from "./form";
import { Card, Divider } from "./ui";

/**
 * What you've already put in for the tax year. With it, the plan knows the exact room left (and that
 * IRA/HSA room for last year can still be filled until April 15).
 */
export function ContributionsCard() {
  const t = useTheme();
  const { state, start } = usePlan();
  const update = useStore((s) => s.update);
  const thisYear = start.getFullYear();
  const beforeDeadline = start.getMonth() <= 3; // Jan–Apr: last year's IRA/HSA can still be made
  const c = state.contributed;
  const year = c && (c.year === thisYear || (beforeDeadline && c.year === thisYear - 1)) ? c.year : thisYear;
  const values = c && c.year === year ? c : { year, k401: 0, ira: 0, hsa: 0 };
  const set = (patch: Partial<typeof values>) => update((p) => { p.contributed = { ...values, ...patch, year }; });

  const L = limitsFor(state.limits, year);
  const age = state.age + (year - thisYear);
  const caps = {
    k401: L.k401 + (age >= 50 ? L.k401Catch : 0),
    ira: L.ira + (age >= 50 ? L.iraCatch : 0),
    hsa: state.plan.hsaEligible ? (state.plan.hsaFamily ? L.hsaFamily : L.hsaSelf) + (age >= 55 ? L.hsaCatch : 0) : 0,
  };
  const left = (k: keyof typeof caps) => Math.max(0, caps[k] - values[k]);

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
      <FieldRow label="Your 401(k)" hint={`Your own contributions · ${money(left("k401"))} of ${money(caps.k401)} left`}>
        <NumberInput kind="money" label={`401(k) contributed in ${year}`} value={values.k401} onChange={(v) => set({ k401: v })} />
      </FieldRow>
      <Divider />
      <FieldRow label="IRA" hint={`Traditional + Roth together · ${money(left("ira"))} of ${money(caps.ira)} left`}>
        <NumberInput kind="money" label={`IRA contributed for ${year}`} value={values.ira} onChange={(v) => set({ ira: v })} />
      </FieldRow>
      {state.plan.hsaEligible ? (
        <>
          <Divider />
          <FieldRow label="HSA" hint={`Yours + your employer's · ${money(left("hsa"))} of ${money(caps.hsa)} left`}>
            <NumberInput kind="money" label={`HSA contributed for ${year}`} value={values.hsa} onChange={(v) => set({ hsa: v })} />
          </FieldRow>
        </>
      ) : null}
      <View>
        <Text style={[type.caption, { color: t.text3 }]}>
          IRA and HSA contributions for {year} can be made until April 15, {year + 1}. A 401(k) only counts what comes out of paychecks in {year}.
        </Text>
      </View>
    </Card>
  );
}
