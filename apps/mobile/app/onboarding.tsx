import { useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AccountsEditor } from "../components/AccountsEditor";
import { BudgetEditor } from "../components/BudgetEditor";
import { AddDebtButtons, DebtEditor, paidFromFor } from "../components/DebtEditor";
import { EmergencyFundNote, looksLikeEmergencyFund } from "../components/EmergencyFundNote";
import { Button, FieldRow, IconButton, NumberInput, Segmented, TextField } from "../components/form";
import { Icon } from "../components/Icon";
import { RetirementIncomeEditor } from "../components/RetirementIncomeEditor";
import { RecurringGoalFields } from "../components/RecurringGoalFields";
import { useFillPage } from "../components/MasterDetail";
import { ProgressBar, ProgressRing } from "../components/ProgressRing";
import { IncomesEditor } from "../components/IncomeEditor";
import { Card, Divider, Screen } from "../components/ui";
import { HealthcareSuggestion } from "../components/HealthcareSuggestion";
import { ageLabel, money, percent } from "../lib/format";
import { usePlan } from "../lib/plan";
import { syncConfigured } from "../lib/supabase";
import { useSync } from "../lib/sync";
import { HELP } from "../lib/help";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";

// money (accounts + debts) comes before the budget, so debt payments are known and not typed in twice
const STEPS = ["you", "income", "money", "budget", "goals", "review"] as const;
type Step = (typeof STEPS)[number];

export default function Onboarding() {
  const t = useTheme();
  const router = useRouter();
  const fillPage = useFillPage();
  const completeOnboarding = useStore((s) => s.completeOnboarding);
  const [step, setStep] = useState<Step>("you");
  const i = STEPS.indexOf(step);
  const syncEmail = useSync((s) => s.email);
  // a second device: once sign-in pulls down a finished plan, go straight to it
  const onboarded = useStore((s) => s.onboarded);
  useEffect(() => {
    if (onboarded) router.replace("/home");
  }, [onboarded, router]);

  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, i + 1)]!);
  const back = () => setStep(STEPS[Math.max(0, i - 1)]!);
  const finish = () => {
    completeOnboarding();
    router.replace("/home");
  };

  const titles: Record<Step, [string, string]> = {
    you: ["Welcome to Coastline", "Let's start with you. Setup takes about 5 minutes."],
    income: ["Your income", "Every source of money that comes in"],
    budget: ["Your monthly budget", "What life costs now, and what you'll still pay after you retire"],
    money: ["What you have and owe", "Account balances and debts"],
    goals: ["Savings goals", "Optional: things you're saving up for"],
    review: ["Your Coast FI picture", "Here's where you stand"],
  };
  const [title, subtitle] = titles[step];

  return (
    <Screen title={title} subtitle={subtitle} hideSettings maxWidth={1120} fill={fillPage && (step === "income" || step === "budget")}>
      <View style={{ gap: 6 }}>
        <Text style={[type.caption, { color: t.text3 }]}>Step {i + 1} of {STEPS.length}</Text>
        <ProgressBar progress={(i + 1) / STEPS.length} />
      </View>

      {step === "you" ? (
        <Text style={[type.body, { color: t.text2 }]}>
          Coast FI is the point where what you've already invested can grow into your full retirement number on its own, so you'd only need to cover today's bills.
          Everything is in today's dollars{syncConfigured ? "." : ", and your data stays on this device."}
        </Text>
      ) : null}
      {step === "you" && syncConfigured && !syncEmail ? (
        <Text style={[type.caption, { color: t.text2 }]}>
          Already have an account?{" "}
          <Text role="link" style={{ color: t.accent, fontWeight: "700" }} onPress={() => router.push("/sign-in")}>Sign in to load your plan</Text>
        </Text>
      ) : null}
      {step === "you" ? <YouStep /> : null}
      {step === "you" ? <RetirementIncomeBlock /> : null}
      {step === "income" ? <IncomeStep /> : null}
      {step === "budget" ? <BudgetStep /> : null}
      {step === "money" ? <MoneyStep /> : null}
      {step === "goals" ? <GoalsStep /> : null}
      {step === "review" ? <ReviewStep /> : null}

      <View style={[styles.between, { marginTop: space.sm }]}>
        <Button title="Back" icon="back" tone="ghost" onPress={i > 0 ? back : () => (router.canGoBack() ? router.back() : router.replace("/"))} />
        {step === "review" ? (
          <Button title="Go to my dashboard" tone="primary" onPress={finish} />
        ) : (
          <Button title="Continue" tone="primary" onPress={next} />
        )}
      </View>
      <Text style={[type.caption, { color: t.text3, textAlign: "center" }]}>You can change any of this later in the Money tab.</Text>
    </Screen>
  );
}

/* ---------- pieces ---------- */

function Block({ children, hint }: { children: ReactNode; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Card style={{ paddingVertical: space.xs }}>{children}</Card>
      {hint ? <Text style={[type.caption, { color: t.text3, paddingHorizontal: space.xs }]}>{hint}</Text> : null}
    </View>
  );
}

function YouStep() {
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const medicareAge = state.retireAge >= 65;
  return (
    <Block>
      <FieldRow label="Your age" info={HELP.age}>
        <NumberInput kind="int" label="Your age" value={state.age} max={100} onChange={(v) => update((p) => { p.age = v; })} />
      </FieldRow>
      <Divider />
      <FieldRow label="Age you'd like to retire" hint="When work becomes optional" info={HELP.retireAge}>
        <NumberInput kind="int" label="Retirement age" value={state.retireAge} max={100} onChange={(v) => update((p) => { p.retireAge = v; })} />
      </FieldRow>
      <Divider />
      <FieldRow label="How you file taxes" info={HELP.filingStatus} stacked>
  <Segmented
    label="Tax filing status"
    options={[{ value: "single", label: "Single" }, { value: "mfj", label: "Married, filing jointly" }, { value: "hoh", label: "Head of household" }]}
    value={state.filingStatus ?? "single"}
    onChange={(v) => update((p) => { p.filingStatus = v; })}
  />
</FieldRow>
      <Divider />
      <View>
<FieldRow
        label="Health insurance until 65"
        hint={medicareAge ? "You'll retire at 65+, so Medicare covers you. $0 is fine." : `Per month, from ${state.retireAge} until Medicare starts at 65`}
        info={HELP.healthcare}
      >
        <NumberInput kind="money" label="Health insurance per month until 65" value={state.healthcare} onChange={(v) => update((p) => { p.healthcare = v; })} />
      </FieldRow>
{!medicareAge ? <HealthcareSuggestion retireAge={state.retireAge} value={state.healthcare} onUse={(v) => update((p) => { p.healthcare = v; })} /> : null}
</View>
    </Block>
  );
}

function RetirementIncomeBlock() {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.heading, { color: t.text }]}>Income in retirement</Text>
      <Text style={[type.caption, { color: t.text3, marginTop: -space.xs }]}>
        Optional. Social Security or a pension means your savings need to cover less. Skip it if you'd rather plan without it.
      </Text>
      <RetirementIncomeEditor />
    </View>
  );
}

function IncomeStep() {
  return <IncomesEditor />;
}

function BudgetStep() {
  return <BudgetEditor />;
}

function MoneyStep() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  return (
    <>
      <Text style={[type.heading, { color: t.text }]}>Accounts</Text>
      <AccountsEditor />
      <Text style={[type.caption, { color: t.text3, marginTop: -space.xs }]}>
        Rough is fine. You'll update these at each monthly check-in. Tap an account to rename it, change its type or remove it.
      </Text>
      <Text style={[type.heading, { color: t.text, marginTop: space.sm }]}>Debts</Text>
      {state.debts.map((dt, i) => (
        <DebtEditor
          key={dt.id}
          debt={dt}
          paidFrom={paidFromFor(state, dt.id)}
          onChange={(patch) => update((p) => { p.debts[i] = { ...p.debts[i]!, ...patch }; })}
          onRemove={() => update((p) => { p.debts.splice(i, 1); })}
        />
      ))}
      <AddDebtButtons hasAny={state.debts.length > 0} onAdd={(d) => update((p) => { p.debts.push(d); })} />
      {!state.debts.length ? <Text style={[type.caption, { color: t.text3 }]}>No debts? Skip this part.</Text> : null}
    </>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 110, gap: 4 }}>
      <Text style={[type.caption, { color: t.text3 }]}>{label}</Text>
      {children}
    </View>
  );
}

function GoalsStep() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>A house deposit, a car, a wedding… Each goal becomes a step in your plan, just before investing in a brokerage. Things that come around again (holidays, a yearly bill) can repeat. Totally optional.</Text>
      <EmergencyFundNote linkToSettings={false} />
      {state.goals.map((g, i) => (
        <Card key={g.id} style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <TextField label="Goal name" placeholder="e.g. House down payment" value={g.name} onChange={(v) => update((p) => { p.goals[i]!.name = v; })} />
            </View>
            <IconButton icon="trash" color={t.bad} label={`Remove ${g.name}`} onPress={() => update((p) => { p.goals.splice(i, 1); })} />
          </View>
          {looksLikeEmergencyFund(g.name) ? (
            <Text style={[type.caption, { color: t.warn, fontWeight: "600" }]}>This looks like an emergency fund, which your plan already builds for you (see above). You can remove this goal.</Text>
          ) : null}
          <View style={styles.debtGrid}>
            <Labeled label="Target"><NumberInput kind="money" width="100%" label={`${g.name} target`} value={g.target} min={0} onChange={(v) => update((p) => { p.goals[i]!.target = v; })} /></Labeled>
            <Labeled label="Saved so far"><NumberInput kind="money" width="100%" label={`${g.name} saved`} value={g.saved} min={0} onChange={(v) => update((p) => { p.goals[i]!.saved = v; })} /></Labeled>
          </View>
          <RecurringGoalFields goal={g} onChange={(patch) => update((p) => { p.goals[i] = { ...p.goals[i]!, ...patch }; })} />
        </Card>
      ))}
      <Button title="Add a goal" icon="plus" onPress={() => update((p) => { p.goals.push({ id: newId(), name: "", target: 5000, saved: 0 }); })} style={{ alignSelf: "flex-start" }} />
    </>
  );
}

function ReviewStep() {
  const t = useTheme();
  const { result: o } = usePlan();
  const d = o.d;
  const short = d.leanMonthly - d.monthlyExpenses < 0;
  const coastAge = o.crossing === null ? null : d.age + o.crossing;
  return (
    <>
      {short ? (
        <Card style={{ backgroundColor: t.badSoft, borderColor: t.bad }}>
          <Text style={[type.label, { color: t.bad, fontWeight: "700" }]}>Your budget doesn't balance in a normal month</Text>
          <Text style={[type.caption, { color: t.text2 }]}>
            You're short {money(d.monthlyExpenses - d.leanMonthly)}/mo. Coasting only works if today's income covers today's life, so this comes first. Check your take-home and budget.
          </Text>
        </Card>
      ) : null}
      <Card style={{ alignItems: "center", gap: space.md, paddingVertical: space.xl }}>
        <ProgressRing progress={o.progress} size={160} stroke={14} label={`${percent(o.progress)} of the way to Coast FI`}>
          <Text style={[type.title, { color: t.text }]}>{percent(Math.min(o.progress, 9.99))}</Text>
          <Text style={[type.caption, { color: t.text3 }]}>to Coast FI</Text>
        </ProgressRing>
        <Text style={[type.title, { color: t.text, textAlign: "center" }]}>
          {coastAge === null ? "Not before your retirement age yet" : o.crossing === 0 ? "You're already there" : `You can coast at ${Math.floor(coastAge)}`}
        </Text>
        {coastAge !== null && o.crossing! > 0 ? <Text style={[type.body, { color: t.text3 }]}>{ageLabel(coastAge)}</Text> : null}
      </Card>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <Card style={{ flex: 1 }}>
          <Text style={[type.caption, { color: t.text3 }]}>FIRE number</Text>
          <Text style={[type.stat, { color: t.text }]}>{money(o.fire, { whole: true })}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={[type.caption, { color: t.text3 }]}>Odds by {d.retireAge}</Text>
          <Text style={[type.stat, { color: o.mc.probFire >= 0.8 ? t.good : o.mc.probFire >= 0.6 ? t.warn : t.bad }]}>{percent(o.mc.probFire)}</Text>
        </Card>
      </View>
      <View style={[styles.note, { backgroundColor: t.surface2 }]}>
        <Icon name="info" size={16} color={t.text3} />
        <Text style={[type.caption, { color: t.text2, flex: 1 }]}>
          Built on conservative assumptions: {percent(d.r, 1)} real return, {percent(d.vol)} volatility, {percent(d.swr, 1)} withdrawal rate. Change them in Settings → Assumptions.
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  budgetRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  debtGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  note: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, alignItems: "flex-start" },
});
