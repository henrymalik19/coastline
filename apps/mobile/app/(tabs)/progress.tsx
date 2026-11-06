import { ComingSoon } from "../../components/ComingSoon";

export default function Progress() {
  return (
    <ComingSoon
      title="Progress"
      subtitle="Track it, and keep the streak"
      icon="trend"
      heading="See how far you have come"
      points={["Projection with realistic ranges, not one line", "What-if sliders for savings, returns and spending", "Monthly check-ins, streaks and badges"]}
    />
  );
}
