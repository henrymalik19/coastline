/**
 * Money: what the plan runs on. Your accounts first (tap one for its transactions, which live on the
 * Budget tab), then the pages for income, accounts, debts, goals and income in retirement.
 */
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../../../components/Icon";
import { NetWorthCard } from "../../../components/MoneyCards";
import { SectionGroups } from "../../../components/settings/SectionPages";
import { Card, Divider, Screen, SectionLabel } from "../../../components/ui";
import { money } from "../../../lib/format";
import { useLayout } from "../../../lib/layout";
import { usePlan } from "../../../lib/plan";
import { budgetAccounts } from "../../../lib/register";
import { useStore } from "../../../lib/store";
import { space, type, useTheme } from "../../../lib/theme";

export default function MoneyHome() {
  const t = useTheme();
  const router = useRouter();
  const { contentWidth } = useLayout();
  const { state } = usePlan();
  const txns = useStore((s) => s.txns);
  const accts = budgetAccounts(state);
  const started = !!state.budgetPlan;
  const count = (id?: string) => txns.filter((x) => !x.deleted && (!id || x.accountId === id)).length;
  const row = (key: string, name: string, hint: string, value: string | null, href: string) => (
    <Pressable
      key={key}
      role="link"
      accessibilityLabel={`${name}${value ? ` ${value}` : ""}: ${hint}`}
      onPress={() => router.push(href as never)}
      style={(st) => [styles.row, { backgroundColor: st.pressed || (st as typeof st & { hovered?: boolean }).hovered ? t.surface2 : "transparent" }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.body, { color: t.text, fontWeight: "500" }]}>{name}</Text>
        <Text numberOfLines={1} style={[type.caption, { color: t.text3 }]}>{hint}</Text>
      </View>
      {value ? <Text style={[type.body, { color: t.text, fontVariant: ["tabular-nums"] }]}>{value}</Text> : null}
      <Icon name="chevron" size={16} color={t.text3} />
    </Pressable>
  );

  return (
    <Screen title="Money" subtitle={contentWidth < 600 ? undefined : "What you have, earn and owe"} narrow>
      <NetWorthCard />
      <View style={{ gap: space.sm }}>
        <Text style={[type.overline, { color: t.text3, paddingHorizontal: space.xs }]}>Accounts you spend from</Text>
        <Card padded={false}>
          {started ? (
            <>
              {row("all", "All transactions", `${count()} in your budget`, null, "/budget?view=transactions")}
              {accts.map((a) => (
                <View key={a.id}>
                  <View style={{ marginLeft: space.lg }}><Divider /></View>
                  {row(a.id, a.name, `${a.kind === "card" ? "Credit card" : "Cash"} · ${count(a.id)} transaction${count(a.id) === 1 ? "" : "s"}`, a.kind === "card" ? `${money(-a.balance)} owed` : money(a.balance), `/budget?view=transactions&account=${a.id}`)}
                </View>
              ))}
            </>
          ) : (
            <View style={{ padding: space.lg, gap: space.sm }}>
              <SectionLabel>Transactions</SectionLabel>
              <Text style={[type.caption, { color: t.text3 }]}>Start your monthly budget on the Budget tab to track what you spend from checking and your cards.</Text>
            </View>
          )}
        </Card>
      </View>
      <SectionGroups base="/money" heading="Your money" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 58 },
});
