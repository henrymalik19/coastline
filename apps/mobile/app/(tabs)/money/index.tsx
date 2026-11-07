import { Redirect } from "expo-router";

/** The Money tab moved: net worth is on Home, goals on Progress, and the pages are in Settings. */
export default function MoneyOverview() {
  return <Redirect href="/settings" />;
}
