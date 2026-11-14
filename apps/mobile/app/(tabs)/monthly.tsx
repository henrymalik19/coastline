import { Redirect } from "expo-router";

/** The old Monthly tab: this month's to-dos are on Home now. */
export default function Monthly() {
  return <Redirect href="/home" />;
}
