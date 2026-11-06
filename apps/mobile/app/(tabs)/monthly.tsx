import { ComingSoon } from "../../components/ComingSoon";

export default function Monthly() {
  return (
    <ComingSoon
      title="Monthly"
      subtitle="Your money, month by month"
      icon="calendar"
      heading="Every month, planned out"
      points={["How this month and next month split up", "36-month savings chart, with extra-paycheck months marked", "A table view for every chart"]}
    />
  );
}
