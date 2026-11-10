/**
 * Money: what the plan runs on. Your net worth, then the pages for income, accounts, debts, goals and
 * income in retirement. (Transactions and the accounts you spend from live on the Budget tab.)
 */
import { NetWorthCard } from "../../../components/MoneyCards";
import { SectionGroups } from "../../../components/settings/SectionPages";
import { Screen } from "../../../components/ui";
import { useLayout } from "../../../lib/layout";

export default function MoneyHome() {
  const { contentWidth } = useLayout();
  return (
    <Screen title="Money" subtitle={contentWidth < 600 ? undefined : "What you have, earn and owe"} narrow>
      <NetWorthCard />
      <SectionGroups base="/money" heading="Your money" />
    </Screen>
  );
}
