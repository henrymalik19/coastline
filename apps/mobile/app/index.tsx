import { Redirect } from "expo-router";
import { useStore } from "../lib/store";

/** Until setup is finished the app opens setup; afterwards Home. Waits for saved data to load. */
export default function Index() {
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  if (!hydrated) return null;
  return <Redirect href={onboarded ? "/home" : "/onboarding"} />;
}
