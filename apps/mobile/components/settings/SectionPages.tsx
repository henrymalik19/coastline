import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money } from "../../lib/format";
import { usePlan } from "../../lib/plan";
import { syncConfigured } from "../../lib/supabase";
import { useSync } from "../../lib/sync";
import { radius, space, type, useTheme } from "../../lib/theme";
import { Icon } from "../Icon";
import { useFillPage } from "../MasterDetail";
import { Card, Divider, Screen } from "../ui";
import { findSection, SECTION_SCREENS, SECTIONS } from "./sections";

/** The "Your money" pages live in the Money tab; the rest stay in Settings. */
export const MONEY_GROUP = "Your money";
export type SectionBase = "/money" | "/settings";
export const groupsFor = (base: SectionBase) => SECTIONS.filter((g) => (g.title === MONEY_GROUP) === (base === "/money"));

/** One-line summary under each page's name. */
function useSummaries(): Record<string, string> {
  const { state, result } = usePlan();
  const syncEmail = useSync((s) => s.email);
  const retire = state.retirementIncome ?? [];
  return {
    account: syncConfigured ? (syncEmail ? `Signed in as ${syncEmail}` : "Not signed in") : "Saved on this device",
    profile: `Age ${state.age} · retire at ${state.retireAge}`,
    retirementIncome: retire.length ? `${retire.length} · ${money(result.d.retireIncomeAnnual / 12)}/mo` : "None added",
    income: state.incomes.length ? `${state.incomes.length} source${state.incomes.length > 1 ? "s" : ""} · ${money(result.d.leanMonthly)}/mo` : "None yet",
    budget: `${state.budget.length} items · ${money(result.d.budgetTotal)}/mo`,
    accounts: `${state.accounts.length} accounts · ${money(result.d.invested + result.d.bal.cash)}`,
    debts: state.debts.length ? `${state.debts.length} · ${money(result.d.debtTotal)}` : "None",
    goals: state.goals.length ? `${state.goals.length} goal${state.goals.length > 1 ? "s" : ""}` : "None",
    assumptions: `${(state.ret * 100).toFixed(1)}% return · ${(state.swr * 100).toFixed(2)}% withdrawal`,
    limits: `${state.limits.length} years`,
    data: "Export, import, reset",
  };
}

/** A list of pages (Money tab or Settings), each row opening `${base}/${key}`. */
export function SectionIndex({ base, title, subtitle }: { base: SectionBase; title: string; subtitle: string }) {
  const t = useTheme();
  const router = useRouter();
  const summary = useSummaries();
  const groups = groupsFor(base);
  return (
    <Screen title={title} subtitle={subtitle} narrow hideSettings={base === "/settings"}>
      {groups.map((group) => (
        <View key={group.title} style={{ gap: space.sm }}>
          {groups.length > 1 ? <Text style={[type.overline, { color: t.text3, paddingHorizontal: space.xs }]}>{group.title}</Text> : null}
          <Card padded={false}>
            {group.items.map((s, i) => (
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
    </Screen>
  );
}

const FULL_PAGE = new Set(["income", "budget"]);

/** One page from the list; Back returns to that list. */
export function SectionPage({ base }: { base: SectionBase }) {
  const t = useTheme();
  const router = useRouter();
  const fillPage = useFillPage();
  const { section } = useLocalSearchParams<{ section: string }>();
  const meta = findSection(section);
  const Body = meta ? SECTION_SCREENS[meta.key] : undefined;
  return (
    // income and budget are two-pane editors: on tall wide screens full height, scrolling inside their panes
    <Screen
      title={meta?.title ?? "Not found"}
      subtitle={meta?.subtitle}
      narrow={!(meta && FULL_PAGE.has(meta.key))}
      fill={fillPage && !!meta && FULL_PAGE.has(meta.key)}
      back={() => (router.canGoBack() ? router.back() : router.replace(base))}
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
