import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BudgetEditor } from "../components/BudgetEditor";
import { AddDebtButtons, DebtEditor } from "../components/DebtEditor";
import { Button, FieldRow, IconButton, NumberInput, TextField } from "../components/form";
import { Icon } from "../components/Icon";
import { ProgressBar, ProgressRing } from "../components/ProgressRing";
import { IncomesEditor } from "../components/IncomeEditor";
import { Card, Divider, Screen } from "../components/ui";
import { HealthcareSuggestion } from "../components/HealthcareSuggestion";
import { ageLabel, money, percent } from "../lib/format";
import { usePlan } from "../lib/plan";
import { HELP } from "../lib/help";
import { freshPlan } from "../lib/presets";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";

const STEPS = ["you", "income", "budget", "money", "goals", "review"] as const;
type Step = (typeof STEPS)[number] | "welcome";

export default function Onboarding() {
  const t = useTheme();
  const router = useRouter();
  const onboarded = useStore((s) => s.onboarded);
  const startFresh = useStore((s) => s.startFresh);
  const markWelcomeSeen = useStore((s) => s.markWelcomeSeen);
  const completeOnboarding = useStore((s) => s.completeOnboarding);
  const [step, setStep] = useState<Step>("welcome");
  const i = STEPS.indexOf(step as (typeof STEPS)[number]);

  const go = (s: Step) => setStep(s);
  const next = () => go(STEPS[Math.min(STEPS.length - 1, i + 1)]!);
  const back = () => (i <= 0 ? go("welcome") : go(STEPS[i - 1]!));
  const finish = () => {
    completeOnboarding();
    markWelcomeSeen();
    router.replace("/home");
  };

  if (step === "welcome") {
    return (
      <Screen title="Welcome to Coast FI" subtitle="See how close you are to never needing to invest another dollar" hideSettings maxWidth={880}>
        <Card style={{ gap: space.md }}>
          <Text style={[type.body, { color: t.text2 }]}>
            Coast FI is the point where what you've already invested can grow into your full retirement number on its own. You'd only need to cover today's bills from then on.
          </Text>
          <Text style={[type.body, { color: t.text2 }]}>
            Setup takes about 5 minutes. Everything is in today's dollars, the math is shown next to every result, and your data stays on this device.
          </Text>
        </Card>
        <Choice
          icon="sparkle"
          title={onboarded ? "Walk through my plan again" : "Set up my plan"}
          desc="Age, income, budget, balances and goals. About 5 minutes."
          onPress={() => {
            // replace the sample with a blank plan; never wipe entries you've already made
            if (useStore.getState().isSampleData) startFresh(freshPlan());
            markWelcomeSeen();
            go("you");
          }}
          primary
        />
        <Choice icon="trend" title="Explore the sample plan first" desc="Look around with example numbers. Set up yours any time." onPress={() => { markWelcomeSeen(); router.replace("/home"); }} />
        <Choice icon="database" title="Import a backup" desc="From this app or the original Coast FI prototype." onPress={() => { markWelcomeSeen(); router.replace("/settings/data"); }} />
      </Screen>
    );
  }

  const titles: Record<(typeof STEPS)[number], [string, string]> = {
    you: ["About you", "Two ages and a healthcare estimate"],
    income: ["Your income", "Paychecks and your 401(k) match"],
    budget: ["Your monthly budget", "What life costs now, and what continues in retirement"],
    money: ["What you have and owe", "Account balances and debts"],
    goals: ["Savings goals", "Optional: things you're saving up for"],
    review: ["Your Coast FI picture", "Here's where you stand"],
  };
  const [title, subtitle] = titles[step];

  return (
    <Screen title={title} subtitle={subtitle} hideSettings maxWidth={1120} fill={step === "income" || step === "budget"}>
      <View style={{ gap: 6 }}>
        <View style={styles.between}>
          <Text style={[type.caption, { color: t.text3 }]}>Step {i + 1} of {STEPS.length}</Text>
          {step !== "review" ? (
            <Pressable role="button" onPress={finish} hitSlop={8}>
              <Text style={[type.caption, { color: t.accent, fontWeight: "600" }]}>Skip setup</Text>
            </Pressable>
          ) : null}
        </View>
        <ProgressBar progress={(i + 1) / STEPS.length} />
      </View>

      {step === "you" ? <YouStep /> : null}
      {step === "income" ? <IncomeStep /> : null}
      {step === "budget" ? <BudgetStep /> : null}
      {step === "money" ? <MoneyStep /> : null}
      {step === "goals" ? <GoalsStep /> : null}
      {step === "review" ? <ReviewStep /> : null}

      <View style={[styles.between, { marginTop: space.sm }]}>
        <Button title="Back" icon="back" tone="ghost" onPress={back} />
        {step === "review" ? (
          <Button title="Go to my dashboard" tone="primary" onPress={finish} />
        ) : (
          <Button title="Continue" tone="primary" onPress={next} />
        )}
      </View>
      <Text style={[type.caption, { color: t.text3, textAlign: "center" }]}>You can change any of this later in Settings.</Text>
    </Screen>
  );
}

/* ---------- pieces ---------- */

function Choice({ icon, title, desc, onPress, primary }: { icon: "sparkle" | "trend" | "database"; title: string; desc: string; onPress: () => void; primary?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={`${title}. ${desc}`}
      onPress={onPress}
      style={(s) => {
        const hovered = (s as typeof s & { hovered?: boolean }).hovered;
        return [
          styles.choice,
          { backgroundColor: t.surface, borderColor: primary ? t.accent : t.border, borderWidth: primary ? 2 : StyleSheet.hairlineWidth, opacity: s.pressed ? 0.85 : 1 },
          hovered ? { backgroundColor: t.surface2 } : null,
        ];
      }}
    >
      <View style={[styles.choiceIcon, { backgroundColor: primary ? t.accent : t.accentSoft }]}>
        <Icon name={icon} size={20} color={primary ? "#fff" : t.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.heading, { color: t.text }]}>{title}</Text>
        <Text style={[type.caption, { color: t.text3 }]}>{desc}</Text>
      </View>
      <Icon name="chevron" size={18} color={t.text3} />
    </Pressable>
  );
}

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
      <Block hint="Rough is fine. You'll update these at each monthly check-in.">
        {state.accounts.map((a, i) => (
          <View key={a.id}>
            <FieldRow label={a.name} info={HELP[a.type]}>
              <NumberInput kind="money" label={`${a.name} balance`} value={a.balance} onChange={(v) => update((p) => { p.accounts[i]!.balance = v; })} />
            </FieldRow>
            {i < state.accounts.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </Block>
      <Text style={[type.heading, { color: t.text, marginTop: space.sm }]}>Debts</Text>
      {state.debts.map((dt, i) => (
        <DebtEditor
          key={dt.id}
          debt={dt}
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
      <Text style={[type.body, { color: t.text2 }]}>A house deposit, a car, a wedding… Each goal becomes a step in your plan, just before investing in a brokerage. Totally optional.</Text>
      {state.goals.map((g, i) => (
        <Card key={g.id} style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <TextField label="Goal name" placeholder="e.g. House down payment" value={g.name} onChange={(v) => update((p) => { p.goals[i]!.name = v; })} />
            </View>
            <IconButton icon="trash" color={t.bad} label={`Remove ${g.name}`} onPress={() => update((p) => { p.goals.splice(i, 1); })} />
          </View>
          <View style={styles.debtGrid}>
            <Labeled label="Target"><NumberInput kind="money" width="100%" label={`${g.name} target`} value={g.target} min={0} onChange={(v) => update((p) => { p.goals[i]!.target = v; })} /></Labeled>
            <Labeled label="Saved so far"><NumberInput kind="money" width="100%" label={`${g.name} saved`} value={g.saved} min={0} onChange={(v) => update((p) => { p.goals[i]!.saved = v; })} /></Labeled>
          </View>
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
          <Text style={[type.stat, { color: t.text }]}>{money(o.fire, { compact: true })}</Text>
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
  choice: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, minHeight: 72 },
  choiceIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  budgetRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  debtGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  note: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, alignItems: "flex-start" },
});
