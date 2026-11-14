import { Redirect, useLocalSearchParams } from "expo-router";

/** The Progress tab is gone: its pieces moved to Forecast (What if), Your number, and Badges. Old links land there. */
export default function Progress() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  if (view === "number") return <Redirect href="/number" />;
  if (view === "badges") return <Redirect href="/badges" />;
  return <Redirect href={view === "whatif" ? "/plan?view=whatif" : "/plan"} />;
}
