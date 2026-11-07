import type { Goal } from "@coastfi/engine";
import { Text, View } from "react-native";
import { money } from "../lib/format";
import { space, type, useTheme } from "../lib/theme";
import { FieldRow, MonthField, Segmented, ToggleRow } from "./form";

const EVERY = [
  { value: "12", label: "Yearly" },
  { value: "6", label: "Every 6 mo" },
  { value: "3", label: "Every 3 mo" },
] as const;

/** "YYYY-MM" n months from now (a UI default only; the engine never reads the clock). */
function monthsFromNow(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dueLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const everyLabel = (n: number) => (n === 12 ? "yearly" : n === 1 ? "monthly" : `every ${n} months`);

/** The "repeats" switch on a goal, and when on: how often, next due month, and whether it continues in retirement. */
export function RecurringGoalFields({ goal, onChange }: { goal: Goal; onChange: (patch: Partial<Goal>) => void }) {
  const t = useTheme();
  const r = goal.recurring;
  return (
    <View style={{ gap: space.xs }}>
      <ToggleRow
        label="Repeats"
        hint="Holidays, yearly insurance, annual trips: set aside a little each month, spend it when it's due"
        value={!!r}
        onChange={(on) => onChange({ recurring: on ? { every: 12, due: monthsFromNow(12) } : undefined })}
      />
      {r ? (
        <View style={{ gap: space.xs }}>
          <FieldRow label="How often" stacked>
            <Segmented label="How often" options={EVERY.map((e) => ({ ...e }))} value={String(r.every) as "12" | "6" | "3"} onChange={(v) => onChange({ recurring: { ...r, every: Number(v) } })} />
          </FieldRow>
          <FieldRow label="Next due" hint="The month you'll spend it">
            <MonthField label={`${goal.name || "Goal"} next due`} value={r.due} onChange={(v) => onChange({ recurring: { ...r, due: v } })} />
          </FieldRow>
          <ToggleRow
            label="Still pay after I retire"
            value={r.inRetirement !== false}
            onChange={(on) => onChange({ recurring: { ...r, inRetirement: on ? undefined : false } })}
          />
          {goal.target > 0 ? (
            <Text style={[type.caption, { color: t.text3 }]}>
              About {money(goal.target / r.every, { whole: true })}/mo set aside ({money(goal.target)} {everyLabel(r.every)}). If you're behind, the plan catches up
              before {dueLabel(r.due)}; if you saved extra, later months ask for less. Update "saved so far" at your monthly check-in.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
