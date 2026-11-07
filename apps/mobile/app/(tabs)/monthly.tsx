import { Redirect } from "expo-router";

/** The month-by-month charts moved to the Plan tab (Charts). */
export default function Monthly() {
  return <Redirect href="/plan?view=charts" />;
}
