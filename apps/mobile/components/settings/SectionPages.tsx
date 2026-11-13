import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppearance } from "../../lib/appearance";
import { money } from "../../lib/format";
import { usePlan } from "../../lib/plan";
import { syncConfigured } from "../../lib/supabase";
import { useSync } from "../../lib/sync";
import { useSharing } from "../../lib/sharing";
import { radius, space, type, useTheme } from "../../lib/theme";
import { Icon } from "../Icon";
import { useFillPage } from "../MasterDetail";
import { Card, Divider, Screen } from "../ui";
import { findSection, SECTION_SCREENS, SECTIONS } from "./sections";

/** These pages live in the Money tab (what you have today, and what retirement looks like); the rest stay in Settings. */
export const MONEY_GROUPS = ["Today", "In retirement"];
export type SectionBase = "/money" | "/settings";
// Money has those pages; Settings has the rest (old /settings/income links still open)
export const groupsFor = (base: SectionBase) =>
  base === "/settings" ? SECTIONS.filter((g) => !MONEY_GROUPS.includes(g.title)) : SECTIONS.filter((g) => MONEY_GROUPS.includes(g.title));

/** One-line summary under each page's name. */
function useSummaries(): Record<string, string> {
  const { state, result } = usePlan();
  const syncEmail = useSync((s) => s.email);
  const sharedBy = useSync((s) => (s.planId && s.planId !== s.userId ? s.sharedBy ?? "the plan's owner" : undefined));
  const appearance = useAppearance((s) => s.appearance);
  const members = useSharing((s) => s.members);
  const retire = state.retirementIncome ?? [];
  return {
    appearance: { system: "Match device", light: "Light", dark: "Dark" }[appearance],
    sharing: sharedBy ? `Shared by ${sharedBy}` : members.length ? `${members.length} ${members.length === 1 ? "person" : "people"}` : "Not shared",
    account: syncConfigured ? (syncEmail ? `Signed in as ${syncEmail}` : "Not signed in") : "Saved on this device",
    profile: `Age ${state.age} · retire at ${state.retireAge}`,
    healthcare: state.retireAge >= 65 ? `Medicare ${money(state.medicare ?? 0)}/mo` : `${money(state.healthcare)}/mo until 65 · ${money(state.medicare ?? 0)}/mo after`,
    retirement: (() => {
      const items = state.budget.filter((b) => !b.accountId);
      const after = items.filter((b) => b.inRetirement).reduce((a, b) => a + b.amount, 0);
      const ess = items.filter((b) => b.essential !== false).reduce((a, b) => a + b.amount, 0);
      return items.length ? `${money(after)}/mo after retiring · ${money(ess)} essential` : "No categories yet";
    })(),
    retirementIncome: retire.length + result.d.rentals.length ? `${retire.length + result.d.rentals.length} · ${money(result.d.retireIncomeAnnual / 12)}/mo` : "None added",
    income: state.incomes.length ? `${state.incomes.length} source${state.incomes.length > 1 ? "s" : ""} · ${money(result.d.leanMonthly)}/mo` : "None yet",
    budget: `${state.budget.length} items · ${money(result.d.budgetTotal)}/mo`,
    savings: (() => { const n = Object.keys({ ...(state.plan.schedule ?? {}), ...(state.plan.scheduleMonths ?? {}) }).length; return n ? `${n} account${n > 1 ? "s" : ""} set · ${money(result.plan.months[0]?.plannedAsk ?? 0)}/mo` : "None set"; })(),
    accounts: `${state.accounts.length} accounts · ${money(result.d.invested + result.d.bal.cash)}`,
    properties: (() => { const ps = state.properties ?? []; const r = ps.filter((p) => p.kind === "rental").length; return ps.length ? `${ps.length - r ? `${ps.length - r} home${ps.length - r > 1 ? "s" : ""}` : ""}${ps.length - r && r ? " · " : ""}${r ? `${r} rental${r > 1 ? "s" : ""}` : ""} · ${money(result.d.bal.property ?? 0)}` : "None"; })(),
    debts: state.debts.length ? `${state.debts.length} · ${money(result.d.debtTotal)}` : "None",
    goals: state.goals.length ? `${state.goals.length} goal${state.goals.length > 1 ? "s" : ""}` : "None",
    priorities: `${state.plan.steps.length} steps · emergency fund, debts, retirement accounts`,
    assumptions: `${(state.ret * 100).toFixed(1)}% return · ${(state.swr * 100).toFixed(2)}% withdrawal`,
    limits: `${state.limits.length} years`,
    data: "Export, import, reset",
  };
}

/** A list of pages (Money tab or Settings), each row opening `${base}/${key}`. */
export function SectionIndex({ base, title, subtitle }: { base: SectionBase; title: string; subtitle: string }) {
  return (
    <Screen title={title} subtitle={subtitle} narrow hideSettings={base === "/settings"}>
      <SectionGroups base={base} />
    </Screen>
  );
}

/** The page rows on their own (the Money tab puts its accounts above them). */
export function SectionGroups({ base, heading }: { base: SectionBase; heading?: string }) {
  const t = useTheme();
  const router = useRouter();
  const summary = useSummaries();
  const groups = groupsFor(base);
  return (
    <>
      {groups.map((group) => (
        <View key={group.title} style={{ gap: space.sm }}>
          {groups.length > 1 || heading ? <Text style={[type.overline, { color: t.text3, paddingHorizontal: space.xs }]}>{groups.length > 1 ? group.title : heading ?? group.title}</Text> : null}
          <Card padded={false}>
            {group.items.filter((s) => !s.hidden).map((s, i) => (
              <View key={s.key}>
                <Pressable
                  role="link"
                  accessibilityLabel={`${s.title}: ${summary[s.key]}`}
                  onPress={() => router.push(`${base}/${s.key}`)}
                  style={(st) => {
                    const hovered = (st as typeof st & { hovered?: boolean }).hovered;
                    return [styles.row, { backgroundColor: st.pressed || hovered ? t.surface2 : "transparent" }];
                  }}
                >
                  <View style={[styles.icon, { backgroundColor: t.accentSoft }]}>
                    <Icon name={s.icon} size={18} color={t.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: t.text, fontWeight: "500" }]}>{s.title}</Text>
                    <Text style={[type.caption, { color: t.text3 }]}>{summary[s.key]}</Text>
                  </View>
                  <Icon name="chevron" size={18} color={t.text3} />
                </Pressable>
                {i < group.items.length - 1 ? <View style={{ marginLeft: 64 }}><Divider /></View> : null}
              </View>
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}

const FULL_PAGE = new Set(["income", "budget"]);

/** One page from the list; Back returns to that list. */
export function SectionPage({ base }: { base: SectionBase }) {
  const t = useTheme();
  const router = useRouter();
  const fillPage = useFillPage();
  // `from`: the section page that linked here (e.g. Savings goals → Accounts), so Back returns to it
  const { section, from } = useLocalSearchParams<{ section: string; from?: string }>();
  const meta = findSection(section);
  const fromMeta = from && from !== section ? findSection(from) : undefined;
  const Body = meta ? SECTION_SCREENS[meta.key] : undefined;
  return (
    // income and budget are two-pane editors: on tall wide screens full height, scrolling inside their panes
    <Screen
      title={meta?.title ?? "Not found"}
      subtitle={meta?.subtitle}
      narrow={!(meta && FULL_PAGE.has(meta.key))}
      fill={fillPage && !!meta && FULL_PAGE.has(meta.key)}
      // always back to its list (Money or Settings), even when opened from another tab or a link
      back={() => router.navigate(fromMeta ? `${base}/${fromMeta.key}` : base)}
      hideSettings
    >
      {Body ? <Body /> : <Text style={{ color: t.text2 }}>That page doesn't exist.</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 60 },
  icon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
