import { NumberBreakdown } from "../../components/NumberBreakdown";
import { Screen } from "../../components/ui";

/** How your FIRE and Coast numbers are worked out (opened from Home and Forecast). */
export default function YourNumber() {
  return (
    <Screen title="Your number" subtitle="How it's worked out" back="/plan">
      <NumberBreakdown />
    </Screen>
  );
}
