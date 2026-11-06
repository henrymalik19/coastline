import { Redirect } from "expo-router";
import { useStore } from "../lib/store";

/** First launch → welcome/onboarding; afterwards → Home. Waits for saved data to load. */
export default function Index() {
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  const seenWelcome = useStore((s) => s.seenWelcome);
  if (!hydrated) return null;
  return <Redirect href={!onboarded && !seenWelcome ? "/onboarding" : "/home"} />;
}
