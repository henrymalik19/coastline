import { Stack } from "expo-router";
import { useTheme } from "../../../lib/theme";

/** Keep the list page under any page opened directly (a link, another tab), so Back lands on it. */
export const unstable_settings = { initialRouteName: "index" };


export default function MoneyLayout() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />;
}
