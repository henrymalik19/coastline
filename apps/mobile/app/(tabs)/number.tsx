import { Redirect } from "expo-router";

/** Your number lives on Forecast now (its last view); old links and bookmarks land there. */
export default function YourNumber() {
  return <Redirect href="/plan?view=number" />;
}
