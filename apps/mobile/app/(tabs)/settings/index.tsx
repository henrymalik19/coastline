import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../../../components/Icon";
import { Card, Divider, Screen } from "../../../components/ui";
import { SECTIONS } from "../../../components/settings/sections";
import { money } from "../../../lib/format";
import { usePlan } from "../../../lib/plan";
import { syncConfigured } from "../../../lib/supabase";
import { useSync } from "../../../lib/sync";
import { radius, space, type, useTheme } from "../../../lib/theme";

export default function SettingsIndex() {
  const t = useTheme();
  const router = useRouter();
  const { state, result } = usePlan();
  const syncEmail = useSync((s) => s.email);
  const summary: Record<string, string> = {
    account: syncConfigured ? (syncEmail ? `Signed in as ${syncEmail}` : "Not signed in") : "Saved on this device",
    profile: `Age ${state.age} · retire at ${state.retireAge}`,
    income: state.incomes.length ? `${state.incomes.length} source${state.incomes.length > 1 ? "s" : ""} · ${money(result.d.leanMonthly)}/mo` : "None yet",
    budget: `${state.budget.length} items · ${money(result.d.budgetTotal)}/mo`,
    accounts: `${state.accounts.length} accounts · ${money(result.d.invested + result.d.bal.cash)}`,
    debts: state.debts.length ? `${state.debts.length} · ${money(result.d.debtTotal)}` : "None",
    goals: state.goals.length ? `${state.goals.length} goal${state.goals.length > 1 ? "s" : ""}` : "None",
    assumptions: `${(state.ret * 100).toFixed(1)}% return · ${(state.swr * 100).toFixed(2)}% withdrawal`,
    limits: `${state.limits.length} years`,
    data: "Export, import, reset",
  };

  return (
    <Screen title="Settings" subtitle="Everything the plan is built from" narrow hideSettings>
      {SECTIONS.map((group) => (
        <View key={group.title} style={{ gap: space.sm }}>
          <Text style={[type.overline, { color: t.text3, paddingHorizontal: space.xs }]}>{group.title}</Text>
          <Card padded={false}>
            {group.items.map((s, i) => (
              <View key={s.key}>
                <Pressable
                  role="link"
                  accessibilityLabel={`${s.title}: ${summary[s.key]}`}
                  onPress={() => router.push(`/settings/${s.key}`)}
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 60 },
  icon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
