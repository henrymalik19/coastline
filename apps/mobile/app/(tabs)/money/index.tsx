/**
 * Money: what the plan runs on. Your net worth, then the pages for income, accounts, debts, goals and
 * income in retirement. (Transactions and the accounts you spend from live on the Budget tab.)
 */
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Icon } from "../../../components/Icon";
import { NetWorthCard } from "../../../components/MoneyCards";
import { SectionGroups } from "../../../components/settings/SectionPages";
import { Card, Screen } from "../../../components/ui";
import { useLayout } from "../../../lib/layout";
import { radius, space, type, useTheme } from "../../../lib/theme";

export default function MoneyHome() {
  const { contentWidth } = useLayout();
  return (
    <Screen title="Money" subtitle={contentWidth < 600 ? undefined : "What you have, earn and owe"} narrow>
      <NetWorthCard />
      <SpendingLink />
      <SectionGroups base="/money" heading="Your money" />
    </Screen>
  );
}

/** The spending report (any period, all spending or a group or category). */
function SpendingLink() {
  const t = useTheme();
  const router = useRouter();
  return (
    <Card padded={false}>
      <Pressable
        role="link"
        onPress={() => router.push("/money/spending")}
        style={(st) => [{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg }, { backgroundColor: st.pressed ? t.surface2 : "transparent" }]}
      >
        <View style={{ width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: t.accentSoft }}>
          <Icon name="card" size={18} color={t.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { color: t.text, fontWeight: "500" }]}>Spending</Text>
          <Text style={[type.caption, { color: t.text3 }]}>Where your money went, by month or year</Text>
        </View>
        <Icon name="chevron" size={18} color={t.text3} />
      </Pressable>
    </Card>
  );
}
