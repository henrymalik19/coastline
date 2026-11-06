import type { Income, PayFreq } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, DateField, FieldRow, IconButton, NumberInput, Segmented, TextField, Toggle } from "../components/form";
import { Icon } from "../components/Icon";
import { ProgressBar, ProgressRing } from "../components/ProgressRing";
import { IncomeSummary } from "../components/settings/sections";
import { Card, Divider, Screen } from "../components/ui";
import { ageLabel, money, percent } from "../lib/format";
import { usePlan } from "../lib/plan";
import { freshPlan, MATCH_PRESETS } from "../lib/presets";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";

const STEPS = ["you", "income", "budget", "money", "goals", "review"] as const;
type Step = (typeof STEPS)[number] | "welcome";

const FREQS: { value: PayFreq; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "semimonthly", label: "Twice a month" },
  { value: "monthly", label: "Monthly" },
];

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
      <Screen title="Welcome to Coast FI" subtitle="See how close you are to never needing to invest another dollar" narrow hideSettings>
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
    <Screen title={title} subtitle={subtitle} narrow hideSettings>
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
  return (
    <Block hint="If you'll leave employer health coverage before Medicare at 65, budget roughly $500–$1,500+ a month per person.">
      <FieldRow label="Your age">
        <NumberInput kind="int" label="Your age" value={state.age} min={0} max={100} onChange={(v) => update((p) => { p.age = v; })} />
      </FieldRow>
      <Divider />
      <FieldRow label="Age you'd like to retire" hint="When work becomes optional">
        <NumberInput kind="int" label="Retirement age" value={state.retireAge} min={0} max={100} onChange={(v) => update((p) => { p.retireAge = v; })} />
      </FieldRow>
      <Divider />
      <FieldRow label="Healthcare before Medicare" hint="Per month, in retirement">
        <NumberInput kind="money" label="Healthcare per month" value={state.healthcare} min={0} onChange={(v) => update((p) => { p.healthcare = v; })} />
      </FieldRow>
    </Block>
  );
}

function IncomeStep() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const inc = state.incomes[0];
  const set = (patch: Partial<Income>) =>
    update((p) => {
      if (!p.incomes[0]) p.incomes.push({ id: newId(), name: "Main job", freq: "biweekly", net: 0, matchMode: "pct" });
      p.incomes[0] = { ...p.incomes[0]!, ...patch };
    });
  if (!inc) {
    return <Button title="Add my main income" icon="plus" onPress={() => set({})} />;
  }
  return (
    <>
      <Block>
        <View style={{ paddingVertical: space.sm, gap: space.sm }}>
          <Text style={[type.label, { color: t.text2 }]}>How often are you paid?</Text>
          <Segmented label="Pay schedule" options={FREQS} value={inc.freq} onChange={(v) => set({ freq: v })} />
        </View>
        <Divider />
        <FieldRow label="Take-home per paycheck" hint="What lands in your bank account">
          <NumberInput kind="money" label="Take-home per paycheck" value={inc.net} min={0} onChange={(v) => set({ net: v })} />
        </FieldRow>
        {inc.freq === "weekly" || inc.freq === "biweekly" ? (
          <>
            <Divider />
            <FieldRow label="Next payday" hint="Finds your 3-paycheck months">
              <DateField label="Next payday" value={inc.nextPayday} onChange={(v) => set({ nextPayday: v })} />
            </FieldRow>
          </>
        ) : null}
      </Block>
      <Block hint="Not sure of your match? It's usually in your benefits portal under 401(k) or retirement plan.">
        <FieldRow label="Gross pay per paycheck" hint="Before taxes">
          <NumberInput kind="money" label="Gross pay per paycheck" value={inc.gross ?? 0} min={0} onChange={(v) => set({ matchMode: "pct", gross: v })} />
        </FieldRow>
        <Divider />
        <FieldRow label="You put into your 401(k)" hint="% of gross pay">
          <NumberInput kind="percent" label="Your 401(k) percent" value={inc.contribPct ?? 0} min={0} max={1} onChange={(v) => set({ matchMode: "pct", contribPct: v })} />
        </FieldRow>
        <Divider />
        <View style={{ paddingVertical: space.md, gap: space.sm }}>
          <Text style={[type.body, { color: t.text }]}>Employer match</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {MATCH_PRESETS.map((m) => {
              const on = (inc.matchRate1 ?? 0) === m.r1 && (inc.matchUpTo1 ?? 0) === m.u1 && (inc.matchRate2 ?? 0) === m.r2 && (inc.matchUpTo2 ?? 0) === m.u2;
              return (
                <Pressable
                  key={m.label}
                  role="radio"
                  aria-checked={on}
                  onPress={() => set({ matchMode: "pct", matchRate1: m.r1, matchUpTo1: m.u1, matchRate2: m.r2, matchUpTo2: m.u2 })}
                  style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }]}
                >
                  <Text style={[type.caption, { color: on ? t.accent : t.text2, fontWeight: on ? "700" : "500" }]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>Something else? Enter the exact formula later in Settings → Income.</Text>
        </View>
        {(inc.gross ?? 0) > 0 ? <View style={{ paddingBottom: space.md }}><IncomeSummary inc={inc} marginalTax={state.plan.marginalTax} /></View> : null}
      </Block>
      <Text style={[type.caption, { color: t.text3 }]}>Side income or a partner's job? Add more income sources in Settings.</Text>
    </>
  );
}

function BudgetStep() {
  const t = useTheme();
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Monthly amounts. Leave debt payments out (they're next). Switch off anything that stops when you retire.
      </Text>
      <Card padded={false}>
        {state.budget.map((b, i) => (
          <View key={b.id}>
            <View style={[styles.budgetRow, { flexDirection: "column", alignItems: "stretch" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <TextField label="Budget item" placeholder="e.g. Pet care" value={b.name} onChange={(v) => update((p) => { p.budget[i]!.name = v; })} />
                </View>
                <NumberInput kind="money" width={120} label={`${b.name} per month`} value={b.amount} min={0} onChange={(v) => update((p) => { p.budget[i]!.amount = v; })} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Toggle label={`${b.name} continues in retirement`} value={b.inRetirement} onChange={(v) => update((p) => { p.budget[i]!.inRetirement = v; })} />
                <Text style={[type.caption, { color: t.text3, flex: 1 }]}>{b.inRetirement ? "Continues in retirement" : "Stops when I retire"}</Text>
                <IconButton icon="trash" label={`Remove ${b.name}`} onPress={() => update((p) => { p.budget.splice(i, 1); })} />
              </View>
            </View>
            <Divider />
          </View>
        ))}
        <View style={[styles.between, { padding: space.lg }]}>
          <Button title="Add a line" icon="plus" tone="ghost" onPress={() => update((p) => { p.budget.push({ id: newId(), name: "", amount: 0, inRetirement: true }); })} />
          <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(result.d.budgetTotal)}/mo</Text>
        </View>
      </Card>
    </>
  );
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
            <FieldRow label={a.name}>
              <NumberInput kind="money" label={`${a.name} balance`} value={a.balance} min={0} onChange={(v) => update((p) => { p.accounts[i]!.balance = v; })} />
            </FieldRow>
            {i < state.accounts.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </Block>
      <Text style={[type.heading, { color: t.text, marginTop: space.sm }]}>Debts</Text>
      {state.debts.map((dt, i) => (
        <Card key={dt.id} style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <TextField label="Debt name" placeholder="e.g. Credit card" value={dt.name} onChange={(v) => update((p) => { p.debts[i]!.name = v; })} />
            </View>
            <IconButton icon="trash" label={`Remove ${dt.name}`} onPress={() => update((p) => { p.debts.splice(i, 1); })} />
          </View>
          <View style={styles.debtGrid}>
            <Labeled label="Balance"><NumberInput kind="money" width="100%" label={`${dt.name} balance`} value={dt.balance} min={0} onChange={(v) => update((p) => { p.debts[i]!.balance = v; })} /></Labeled>
            <Labeled label="APR"><NumberInput kind="percent" width="100%" label={`${dt.name} APR`} value={dt.apr} min={0} onChange={(v) => update((p) => { p.debts[i]!.apr = v; })} /></Labeled>
            <Labeled label="Minimum / mo"><NumberInput kind="money" width="100%" label={`${dt.name} minimum payment`} value={dt.minPayment} min={0} onChange={(v) => update((p) => { p.debts[i]!.minPayment = v; })} /></Labeled>
          </View>
        </Card>
      ))}
      <Button title={state.debts.length ? "Add another debt" : "Add a debt"} icon="plus" onPress={() => update((p) => { p.debts.push({ id: newId(), name: "", balance: 0, apr: 0.2, minPayment: 0 }); })} style={{ alignSelf: "flex-start" }} />
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
            <IconButton icon="trash" label={`Remove ${g.name}`} onPress={() => update((p) => { p.goals.splice(i, 1); })} />
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
