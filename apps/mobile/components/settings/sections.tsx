import { useRouter } from "expo-router";
import { useState, type ComponentType, type ReactNode } from "react";
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { confirm } from "../../lib/confirm";
import { money, percent } from "../../lib/format";
import { estimateBracket } from "../../lib/tax";
import { HELP } from "../../lib/help";
import { usePlan } from "../../lib/plan";
import { newId, useStore } from "../../lib/store";
import { radius, space, type, useTheme } from "../../lib/theme";
import { AccountPanel } from "../AccountPanel";
import { AccountsEditor } from "../AccountsEditor";
import { RetirementIncomeEditor } from "../RetirementIncomeEditor";
import { GoalEditor } from "../GoalEditor";
import { BudgetEditor } from "../BudgetEditor";
import { Button, FieldRow, IconButton, NumberInput, Segmented, TextField, ToggleRow } from "../form";
import { Icon, type IconName } from "../Icon";
import { IncomesEditor } from "../IncomeEditor";
import { EmergencyFundNote, looksLikeEmergencyFund } from "../EmergencyFundNote";
import { AddDebtButtons, DebtEditor, paidFromFor } from "../DebtEditor";
import { debtLabel } from "../../lib/debts";
import { Card, Divider } from "../ui";
import { HealthcareSuggestion } from "../HealthcareSuggestion";

/* ---------- registry ---------- */

type SectionKey = "account" | "profile" | "retirementIncome" | "income" | "budget" | "accounts" | "debts" | "goals" | "assumptions" | "limits" | "data";
type SectionMeta = { key: SectionKey; title: string; subtitle: string; icon: IconName };

export const SECTIONS: { title: string; items: SectionMeta[] }[] = [
  {
    title: "Account",
    items: [
      { key: "account", title: "Account & sync", subtitle: "Sign in to use your plan on every device", icon: "user" },
      { key: "profile", title: "You", subtitle: "Age, retirement age and health insurance", icon: "user" },
    ],
  },
  {
    title: "Your money",
    items: [
      { key: "retirementIncome", title: "Income in retirement", subtitle: "Social Security, pensions and other income after you stop working", icon: "calendar" },
      { key: "income", title: "Income", subtitle: "Jobs, business, rental and other income", icon: "wallet" },
      { key: "budget", title: "Monthly budget", subtitle: "Monthly spending by group (debt payments go under Debts)", icon: "card" },
      { key: "accounts", title: "Accounts", subtitle: "Balances you've saved and invested", icon: "database" },
      { key: "debts", title: "Debts", subtitle: "Balances, interest rates and minimums", icon: "card" },
      { key: "goals", title: "Savings goals", subtitle: "Each goal becomes a step in your plan", icon: "target" },
    ],
  },
  {
    title: "How it's calculated",
    items: [
      { key: "assumptions", title: "Assumptions & plan rules", subtitle: "Returns, withdrawal rate, taxes, emergency fund", icon: "sliders" },
      { key: "limits", title: "Contribution limits", subtitle: "401(k), IRA and HSA limits by year", icon: "shield" },
    ],
  },
  { title: "Data", items: [{ key: "data", title: "Backup & restore", subtitle: "Download a backup, restore one, or start over", icon: "database" }] },
];

export const findSection = (k?: string) => SECTIONS.flatMap((g) => g.items).find((s) => s.key === k);

/* ---------- shared bits ---------- */

function Group({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {title ? <Text style={[type.overline, { color: t.text3, paddingHorizontal: space.xs }]}>{title}</Text> : null}
      <Card style={{ paddingVertical: space.xs }}>{children}</Card>
      {hint ? <Text style={[type.caption, { color: t.text3, paddingHorizontal: space.xs }]}>{hint}</Text> : null}
    </View>
  );
}

/** Rows separated by hairlines. */
function Rows({ children }: { children: (ReactNode | null)[] }) {
  const items = children.filter(Boolean);
  return (
    <>
      {items.map((c, i) => (
        <View key={i}>
          {c}
          {i < items.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </>
  );
}

/** One editable item in a list (a debt, a goal…): header with name + red delete. */
function ItemCard({ name, onName, onDelete, label, placeholder, children }: { name: string; onName: (v: string) => void; onDelete: () => void; label: string; placeholder?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <Card style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField value={name} onChange={onName} label={`${label} name`} placeholder={placeholder} />
        </View>
        <IconButton icon="trash" color={t.bad} label={`Remove ${name || label}`} onPress={onDelete} />
      </View>
      {children}
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  const t = useTheme();
  return (
    <Card style={{ alignItems: "center", paddingVertical: space.xl }}>
      <Text style={[type.body, { color: t.text3 }]}>{text}</Text>
    </Card>
  );
}

async function removeItem(what: string, name: string, doIt: () => void) {
  if (await confirm(`Remove ${what}?`, `"${name || what}" will be removed from your plan.`, "Remove")) doIt();
}

/* ---------- You ---------- */

function Profile() {
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const medicareAge = state.retireAge >= 65;
  return (
    <>
      <Group>
        <Rows>
          {[
            <FieldRow key="age" label="Your age" info={HELP.age}>
              <NumberInput kind="int" label="Your age" value={state.age} max={100} onChange={(v) => update((p) => { p.age = v; })} />
            </FieldRow>,
            <FieldRow key="ret" label="Age you'd like to retire" hint="When work becomes optional" info={HELP.retireAge}>
              <NumberInput kind="int" label="Retirement age" value={state.retireAge} max={100} onChange={(v) => update((p) => { p.retireAge = v; })} />
            </FieldRow>,
            <FieldRow key="fs" label="How you file taxes" info={HELP.filingStatus} stacked>
  <Segmented
    label="Tax filing status"
    options={[{ value: "single", label: "Single" }, { value: "mfj", label: "Married, filing jointly" }, { value: "hoh", label: "Head of household" }]}
    value={state.filingStatus ?? "single"}
    onChange={(v) => update((p) => { p.filingStatus = v; })}
  />
</FieldRow>,
            <View key="hc">
<FieldRow
                            label="Health insurance until 65"
              hint={medicareAge ? "You'll retire at 65+, so Medicare covers you. $0 is fine." : `Per month, from ${state.retireAge} until Medicare starts at 65`}
              info={HELP.healthcare}
            >
              <NumberInput kind="money" label="Health insurance per month until 65" value={state.healthcare} onChange={(v) => update((p) => { p.healthcare = v; })} />
            </FieldRow>
{!medicareAge ? <HealthcareSuggestion retireAge={state.retireAge} value={state.healthcare} onUse={(v) => update((p) => { p.healthcare = v; })} /> : null}
</View>,
            <FieldRow key="cur" label="What you invest today" hint="Per month, from take-home pay" info={HELP.currentInvest}>
              <NumberInput kind="money" label="What you invest today per month" value={state.currentInvestMonthly} onChange={(v) => update((p) => { p.currentInvestMonthly = v; })} />
            </FieldRow>,
          ]}
        </Rows>
      </Group>
    </>
  );
}

/* ---------- Income ---------- */

function IncomeSection() {
  return <IncomesEditor />;
}

/* ---------- Budget ---------- */

function BudgetSection() {
  return <BudgetEditor />;
}

/* ---------- Accounts ---------- */

function AccountsSection() {
  const t = useTheme();
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Cash is your emergency fund. Everything else counts as invested. Tap an account to rename it, change its type, move it or remove it.
      </Text>
      <AccountsEditor />
    </>
  );
}

/* ---------- Income in retirement ---------- */

function RetirementIncomeSection() {
  const t = useTheme();
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Money that starts after you stop working lowers what your savings need to cover. Anything that starts after your retirement age is covered from your savings until it does.
      </Text>
      <RetirementIncomeEditor />
    </>
  );
}

/* ---------- Debts ---------- */

function DebtsSection() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Minimum payments come out of your budget every month. Extra payments go to the highest interest rate first.
      </Text>
      {state.debts.length === 0 ? <Empty text="No debts. Nice." /> : null}
      {state.debts.map((dt, i) => (
        <DebtEditor
          key={dt.id}
          debt={dt}
          paidFrom={paidFromFor(state, dt.id)}
          onChange={(patch) => update((p) => { p.debts[i] = { ...p.debts[i]!, ...patch }; })}
          onRemove={() => removeItem("this debt", debtLabel(dt), () => update((p) => { p.debts.splice(i, 1); }))}
        />
      ))}
      <AddDebtButtons hasAny={state.debts.length > 0} onAdd={(d) => update((p) => { p.debts.push(d); })} />
    </>
  );
}

/* ---------- Goals ---------- */

function GoalsSection() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        Things you're saving up for: a house deposit, a car, a wedding. Change their priority on the Plan tab. Turn on "Repeats" for things that come around again, like holidays or a yearly bill.
      </Text>
      <EmergencyFundNote />
      {state.goals.length === 0 ? <Empty text="No goals yet" /> : null}
      {state.goals.map((g, i) => (
        <GoalEditor
          key={g.id}
          goal={g}
          onChange={(patch) => update((p) => { p.goals[i] = { ...p.goals[i]!, ...patch }; })}
          onRemove={() => removeItem("this goal", g.name, () => update((p) => { p.goals.splice(i, 1); }))}
        />
      ))}
      <Button title="Add goal" icon="plus" onPress={() => update((p) => { p.goals.push({ id: newId(), name: "", target: 5000, saved: 0 }); })} style={{ alignSelf: "flex-start" }} />
    </>
  );
}

/* ---------- Assumptions & plan rules ---------- */

function AssumptionsSection() {
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const pct = (key: string, label: string, info: string, value: number, set: (v: number) => void, max = 1, hint?: string) => (
    <FieldRow key={key} label={label} hint={hint} info={info}>
      <NumberInput kind="percent" label={label} value={value} max={max} onChange={set} />
    </FieldRow>
  );
  return (
    <>
      <Group title="Market assumptions" hint="Everything is in today's dollars, so returns and raises are after inflation.">
        <Rows>
          {[
            pct("ret", "Yearly return (after inflation)", HELP.ret, state.ret, (v) => update((p) => { p.ret = v; }), 0.2, "Default 5%"),
            pct("vol", "Volatility", HELP.vol, state.vol, (v) => update((p) => { p.vol = v; }), 0.6, "Default 15%"),
            pct("fee", "Fund fees", HELP.fee, state.fee, (v) => update((p) => { p.fee = v; }), 0.05),
            pct("swr", "Withdrawal rate", HELP.swr, state.swr, (v) => update((p) => { p.swr = Math.max(0.001, v); }), 0.1, "Default 3.5%"),
            pct("tax", "Tax on pre-tax withdrawals", HELP.taxRate, state.taxRate, (v) => update((p) => { p.taxRate = Math.min(0.9, v); }), 0.9),
            pct("cg", "Raises above inflation", HELP.contribGrowth, state.contribGrowth, (v) => update((p) => { p.contribGrowth = v; }), 0.2, "Per year. Default 0%"),
          ]}
        </Rows>
      </Group>
      <Group title="Plan rules">
        <Rows>
          {[
            <FieldRow key="s" label="Starter emergency fund" info={HELP.starterEF}>
              <NumberInput kind="money" label="Starter emergency fund" value={state.plan.starterEF} onChange={(v) => update((p) => { p.plan.starterEF = v; })} />
            </FieldRow>,
            <FieldRow key="e" label="Full emergency fund" hint="Months of expenses" info={HELP.efMonths}>
              <NumberInput kind="decimal" label="Full emergency fund in months" value={state.plan.efMonths} max={24} step={1} onChange={(v) => update((p) => { p.plan.efMonths = v; })} />
            </FieldRow>,
            pct("hi", '"High-interest" debt starts at', HELP.highApr, state.plan.highApr, (v) => update((p) => { p.plan.highApr = v; })),
            <TaxBracketRow key="mt" />,
            <ToggleRow key="h" label="I have an HSA-eligible health plan" hint="High-deductible plan" value={state.plan.hsaEligible} onChange={(v) => update((p) => { p.plan.hsaEligible = v; })} />,
            state.plan.hsaEligible ? <ToggleRow key="hf" label="HSA family coverage" value={state.plan.hsaFamily} onChange={(v) => update((p) => { p.plan.hsaFamily = v; })} /> : null,
          ]}
        </Rows>
      </Group>
    </>
  );
}

/** Tax bracket: estimated from income and filing status unless the user types their own. */
function TaxBracketRow() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const manual = !!state.plan.marginalTaxManual;
  const est = estimateBracket(state.incomes, state.filingStatus ?? "single");
  const link = { color: t.accent, fontWeight: "700" as const };
  const hint = manual
    ? est
      ? <>Your own number. Our estimate is {percent(est.total)}. <Text role="link" style={link} onPress={() => update((p) => { p.plan.marginalTaxManual = false; })}>Use the estimate</Text></>
      : <>Your own number. Add your pay under Income and we can estimate it.</>
    : est
      ? <>Estimated from your pay and filing status: {percent(est.federal)} federal + {percent(est.state)} state. <Text role="link" style={link} onPress={() => update((p) => { p.plan.marginalTax = est.total; p.plan.marginalTaxManual = true; })}>Set my own</Text></>
      : <>Add your pay under Income and we'll estimate this. Until then it uses the number here.</>;
  return (
    <View style={{ paddingBottom: space.md }}>
      <FieldRow label="Your tax bracket" info={HELP.marginalTax}>
        {manual || !est ? (
          <NumberInput
            kind="percent"
            label="Your tax bracket"
            value={state.plan.marginalTax}
            max={0.6}
            onChange={(v) => update((p) => { p.plan.marginalTax = v; p.plan.marginalTaxManual = true; })}
          />
        ) : (
          <Text style={[type.heading, { color: t.text, fontVariant: ["tabular-nums"] }]}>{percent(est.total)}</Text>
        )}
      </FieldRow>
      <Text style={[type.caption, { color: t.text3, marginTop: -space.xs }]}>{hint}</Text>
    </View>
  );
}

/* ---------- Contribution limits ---------- */

function LimitsSection() {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const fields: { k: "k401" | "k401Catch" | "ira" | "iraCatch" | "hsaSelf" | "hsaFamily" | "hsaCatch"; label: string; catchUp?: boolean }[] = [
    { k: "k401", label: "401(k)" },
    { k: "k401Catch", label: "401(k) catch-up (50+)", catchUp: true },
    { k: "ira", label: "IRA" },
    { k: "iraCatch", label: "IRA catch-up (50+)", catchUp: true },
    { k: "hsaSelf", label: "HSA, just you" },
    { k: "hsaFamily", label: "HSA, family" },
    { k: "hsaCatch", label: "HSA catch-up (55+)", catchUp: true },
  ];
  // open the current year (or the closest one) at first; the rest start collapsed
  const [open, setOpen] = useState<Set<number>>(() => {
    const now = new Date().getFullYear();
    const years = state.limits.map((l) => l.year);
    const pick = years.includes(now) ? now : years.filter((y) => y <= now).sort((a, b) => b - a)[0] ?? Math.min(...years);
    return new Set(state.limits.flatMap((l, i) => (l.year === pick ? [i] : [])));
  });
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <>
      <Text style={[type.body, { color: t.text2 }]}>
        The most the IRS lets you put in each year. Years after the last row reuse it (limits roughly track inflation, so flat is right in today's dollars). Update when new limits are announced.
      </Text>
      {[...state.limits].sort((a, b) => a.year - b.year).map((row) => {
        const i = state.limits.indexOf(row);
        const isOpen = open.has(i);
        return (
          <Card key={`${row.year}-${i}`} style={{ gap: space.xs, paddingVertical: isOpen ? space.lg : space.md }}>
            <Pressable
              role="button"
              aria-expanded={isOpen}
              accessibilityLabel={`${row.year} limits`}
              accessibilityState={{ expanded: isOpen }}
              onPress={() => toggle(i)}
              style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
            >
              <View style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}>
                <Icon name="chevron" size={18} color={t.text3} />
              </View>
              <Text style={[type.heading, { color: t.text, fontVariant: ["tabular-nums"] }]}>{row.year}</Text>
              {!isOpen ? (
                <Text numberOfLines={1} style={[type.caption, { color: t.text3, flex: 1, fontVariant: ["tabular-nums"] }]}>
                  401(k) {money(row.k401)} · IRA {money(row.ira)} · HSA {money(row.hsaSelf)}
                </Text>
              ) : <View style={{ flex: 1 }} />}
            </Pressable>
            {isOpen ? (
              <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Text style={[type.label, { color: t.text2 }]}>Year</Text>
                <NumberInput kind="int" width={100} label="Year" value={row.year} min={2000} max={2100} onChange={(v) => update((p) => { p.limits[i]!.year = v; })} />
              </View>
              <IconButton
                icon="trash"
                color={t.bad}
                label={`Remove ${row.year}`}
                disabled={state.limits.length <= 1}
                onPress={() => { setOpen(new Set()); update((p) => { p.limits.splice(i, 1); }); }}
              />
            </View>
            <Rows>
              {fields.map((f) => (
                <FieldRow key={f.k} label={f.label} info={f.catchUp ? HELP.catchUp : undefined}>
                  <NumberInput kind="money" label={`${row.year} ${f.label}`} value={row[f.k]} step={100} onChange={(v) => update((p) => { p.limits[i]![f.k] = v; })} />
                </FieldRow>
              ))}
            </Rows>
              </>
            ) : null}
          </Card>
        );
      })}
      <Button
        title="Add year"
        icon="plus"
        style={{ alignSelf: "flex-start" }}
        onPress={() => {
          setOpen((s) => new Set(s).add(state.limits.length));
          update((p) => {
            const last = [...p.limits].sort((a, b) => a.year - b.year).at(-1)!;
            p.limits.push({ ...last, year: last.year + 1 });
          });
        }}
      />
    </>
  );
}

/* ---------- Backup & restore ---------- */

function DataSection() {
  const t = useTheme();
  const exportJson = useStore((s) => s.exportJson);
  const importJson = useStore((s) => s.importJson);
  const startFresh = useStore((s) => s.startFresh);
  const router = useRouter();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const doExport = async () => {
    const json = exportJson();
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `coastline-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Downloaded your backup file." });
    } else {
      await Share.share({ message: json, title: "Coastline backup" });
    }
  };
  const doImport = async () => {
    if (!text.trim()) return;
    if (!(await confirm("Restore this backup?", "This replaces your current plan and check-ins with the backup's.", "Restore"))) return;
    try {
      importJson(text);
      setText("");
      setMsg({ ok: true, text: "Restored. Your plan has been updated." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error && e.message ? `Couldn't restore: ${e.message}` : "That doesn't look like a Coastline backup." });
    }
  };

  return (
    <>
      <Group title="Back up">
        <View style={{ paddingVertical: space.sm, gap: space.md }}>
          <Text style={[type.body, { color: t.text2 }]}>Your data lives on this device. Download a backup to keep a copy or move to another device.</Text>
          <Button title={Platform.OS === "web" ? "Download backup" : "Share backup"} tone="primary" icon="database" onPress={doExport} style={{ alignSelf: "flex-start" }} />
        </View>
      </Group>
      <Group title="Restore">
        <View style={{ paddingVertical: space.sm, gap: space.md }}>
          <TextInput
            accessibilityLabel="Paste a Coastline backup"
            multiline
            value={text}
            onChangeText={setText}
            placeholder="Paste the contents of a Coastline backup file here"
            placeholderTextColor={t.text3}
            style={[styles.textarea, { color: t.text, backgroundColor: t.surface2, borderColor: t.border }]}
          />
          <Button title="Restore" onPress={doImport} disabled={!text.trim()} style={{ alignSelf: "flex-start" }} />
        </View>
      </Group>
      {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
      <Group title="Start over">
        <View style={{ paddingVertical: space.sm, gap: space.md }}>
          <Text style={[type.body, { color: t.text2 }]}>Clears your plan and takes you back through setup. Your check-in history is kept.</Text>
          <Button
            title="Start from scratch"
            tone="danger"
            style={{ alignSelf: "flex-start" }}
            onPress={async () => {
              if (!(await confirm("Start from scratch?", "Your current plan will be cleared and you'll go through setup again. Download a backup first if you might want it back.", "Clear plan"))) return;
              startFresh();
              router.replace("/onboarding");
            }}
          />
        </View>
      </Group>
    </>
  );
}

export const SECTION_SCREENS: Record<SectionKey, ComponentType> = {
  account: () => <AccountPanel />,
  profile: Profile,
  retirementIncome: () => <RetirementIncomeSection />,
  income: IncomeSection,
  budget: BudgetSection,
  accounts: AccountsSection,
  debts: DebtsSection,
  goals: GoalsSection,
  assumptions: AssumptionsSection,
  limits: LimitsSection,
  data: DataSection,
};

const styles = StyleSheet.create({
  summary: { borderRadius: radius.md, padding: space.md, gap: space.xs },
  textarea: { minHeight: 120, borderWidth: 1, borderRadius: radius.sm, padding: space.md, fontFamily: Platform.select({ web: "ui-monospace, monospace", default: undefined }), fontSize: 12, textAlignVertical: "top" },
});
