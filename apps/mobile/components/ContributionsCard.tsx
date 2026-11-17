import { limitsFor } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { spouseIraLabel } from "../lib/spouse";
import { space, type, useTheme } from "../lib/theme";
import { Button, FieldRow, NumberInput, Segmented } from "./form";
import { Card, Divider } from "./ui";
import { hsaEligibleInYear } from "./HsaEligibility";
import { useOpenPage } from "../lib/nav";

/**
 * What you've already put in for the tax year. With it, the plan knows the exact room left (and that
 * IRA/HSA room for last year can still be filled until April 15).
 */
export function ContributionsCard() {
  const t = useTheme();
  const { state, start, actual } = usePlan();
  const update = useStore((s) => s.update);
  const router = useRouter();
  const openPage = useOpenPage();
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
    hsa: hsaEligibleInYear(state, year) ? (state.plan.hsaFamily ? L.hsaFamily : L.hsaSelf) + (age >= 55 ? L.hsaCatch : 0) : 0,
    iraSpouse: L.ira + ((state.spouse?.age ?? 0) + (year - thisYear) >= 50 ? L.iraCatch : 0),
  };
  const left = (k: keyof typeof caps) => Math.max(0, caps[k] - values[k]);
  // nothing entered for this year: say what the plan assumes instead (earlier paychecks at today's amounts)
  const entered = !!c && c.year === year;
  const est = year === thisYear && start.getMonth() > 0 ? actual.ytdBefore : undefined;
  const hint = (k: keyof typeof caps) =>
    entered
      ? `${money(left(k), { whole: true })} of ${money(caps[k], { whole: true })} left`
      : k === "ira" || k === "iraSpouse"
        ? "Not entered · plan assumes $0"
        : `Not entered · plan assumes about ${money(est?.[k] ?? 0, { whole: true })}`;
  const deadline = `You can add for ${year} until April 15, ${year + 1}.`;

  return (
    <Card style={{ gap: space.sm }}>
      <Text role="heading" aria-level={2} style={[type.heading, { color: t.text }]}>Contributed so far in {year}</Text>
      <Text style={[type.caption, { color: t.text3 }]}>From your 401(k) site, pay stub or statements, so the plan knows your exact room left.</Text>
      {beforeDeadline ? (
        <Segmented
          label="Tax year"
          options={[{ value: String(thisYear - 1), label: `${thisYear - 1} (until Apr 15)` }, { value: String(thisYear), label: String(thisYear) }]}
          value={String(year)}
          onChange={(v) => update((p) => { p.contributed = { year: Number(v), k401: 0, ira: 0, hsa: 0, ...(c && c.year === Number(v) ? c : null) }; })}
        />
      ) : null}
      <FieldRow
        label="Your 401(k)"
        hint={hint("k401")}
        info={`Only what came out of your own paychecks in ${year} (your pay stub's year-to-date 401(k) line), not your employer's match.`}
      >
        <NumberInput kind="money" label={`401(k) contributed in ${year}`} value={values.k401} onChange={(v) => set({ k401: v })} />
      </FieldRow>
      <Divider />
      <FieldRow label={spIra ? "Your IRA" : "IRA"} hint={hint("ira")} info={`Traditional and Roth IRA together; they share one limit. ${deadline}`}>
        <NumberInput kind="money" label={`IRA contributed for ${year}`} value={values.ira} onChange={(v) => set({ ira: v })} />
      </FieldRow>
      {spIra ? (
        <>
          <Divider />
          <FieldRow label={spouseIraLabel(state)} hint={hint("iraSpouse")} info={`Their own limit, separate from yours. ${deadline}`}>
            <NumberInput kind="money" label={`${spouseIraLabel(state)} contributed for ${year}`} value={values.iraSpouse} onChange={(v) => set({ iraSpouse: v })} />
          </FieldRow>
        </>
      ) : null}
      {hsaEligibleInYear(state, year) ? (
        <>
          <Divider />
          <FieldRow label="HSA" hint={hint("hsa")} info={`Yours plus your employer's; they share one limit. ${deadline}`}>
            <NumberInput kind="money" label={`HSA contributed for ${year}`} value={values.hsa} onChange={(v) => set({ hsa: v })} />
          </FieldRow>
        </>
      ) : null}
      {!hsaEligibleInYear(state, year) ? (
        <Text style={[type.caption, { color: t.text3 }]}>
          No HSA: your plan says you're not on an HSA-eligible health plan.{" "}
          <Text role="link" style={{ color: t.accent, fontWeight: "700" }} onPress={() => openPage("/settings/assumptions")}>
            Change
          </Text>
        </Text>
      ) : null}
      {!entered ? (
        // a 0 that's right (nothing went in yet) looks the same as nothing entered: say so explicitly
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
          <Button title="These are right" icon="check" tone="primary" onPress={() => set({})} style={{ minHeight: 40 }} />
          <Text style={[type.caption, { color: t.text3, flexShrink: 1 }]}>Use them as entered, even $0.</Text>
        </View>
      ) : null}
    </Card>
  );
}
