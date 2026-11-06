import { ComingSoon } from "../../components/ComingSoon";

export default function Plan() {
  return (
    <ComingSoon
      title="Plan"
      subtitle="Where the next dollar goes"
      icon="plan"
      heading="Your priority list, step by step"
      points={["Drag steps to reorder your priorities", "See the status and finish date of each step", "A timeline of every milestone ahead"]}
    />
  );
}
