import { setAsideFor, type Goal } from "@coastfi/engine";
import { usePlan } from "../lib/plan";
import { monthKey } from "../lib/store";
import { MonthlyAmount, plannedNow } from "./ScheduleEditor";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { space, type, useTheme } from "../lib/theme";
import { looksLikeEmergencyFund } from "./EmergencyFundNote";
import { FieldRow, IconButton, InfoText, InfoTip, NumberInput, TextField } from "./form";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressRing";
import { dueLabel, everyLabel, RecurringGoalFields } from "./RecurringGoalFields";
import { Card, Divider } from "./ui";

/**
 * One savings goal. Collapsed: name, progress and (if it repeats) when it's due. Open: name, target,
 * saved so far and the repeat settings. A new, blank goal starts open.
 */
export function GoalEditor({ goal, onChange, onRemove }: { goal: Goal; onChange: (patch: Partial<Goal>) => void; onRemove: () => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(() => !goal.name.trim() && !goal.saved);
  const name = goal.name.trim() || "New goal";
  const r = goal.recurring;
  const { state, start } = usePlan();
  const now = monthKey(start);
  const aside = r ? setAsideFor(goal, now) : 0;
  const per = r ? undefined : plannedNow(state, "goal:" + goal.id, now);
  const [tip, setTip] = useState(false);
  const asideInfo = r
    ? `Usually ${money(goal.target / r.every, { whole: true })}/mo (${money(goal.target, { whole: true })} ${everyLabel(r.every)}), set aside by itself so it's ready when it's due; it shows on your budget as set aside. If you're behind, the plan catches up before ${dueLabel(r.due)}; if you saved extra, later months ask for less. Update "saved so far" at your monthly check-in.`
    : "";
  const summary = `${money(goal.saved, { whole: true })} saved${r ? ` · ${everyLabel(r.every)}, due ${dueLabel(r.due)}` : ""}${r && aside > 0.5 ? ` · ${money(aside)}/mo set aside` : per !== undefined ? ` · +${money(per)}/mo` : ""}`;
  return (
    <Card style={{ gap: space.sm, paddingVertical: space.md, paddingHorizontal: space.md }}>
      <View style={styles.row}>
        <Pressable
          role="button"
          aria-expanded={open}
          accessibilityLabel={`${name} details`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((o) => !o)}
          style={[styles.row, { flex: 1, minHeight: 32 }]}
        >
          <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
            <Icon name="chevron" size={18} color={t.text3} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={[type.body, { color: goal.name.trim() ? t.text : t.text3, fontWeight: "600" }]} numberOfLines={1}>{name}</Text>
            {!open ? (
              <>
                <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{summary}</Text>
                {goal.target > 0 ? <ProgressBar progress={goal.saved / goal.target} color={t.series.goals} height={4} /> : null}
              </>
            ) : null}
          </View>
          <Text style={[type.body, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{money(goal.target, { whole: true })}</Text>
        </Pressable>
      </View>
      {open ? (
        <>
          <TextField label="Goal name" placeholder={r ? "e.g. Car insurance" : "e.g. House down payment"} value={goal.name} onChange={(v) => onChange({ name: v })} />
          {looksLikeEmergencyFund(goal.name) ? (
            <Text style={[type.caption, { color: t.warn, fontWeight: "600" }]}>
              This looks like an emergency fund, which your plan already builds for you. You can remove this goal.
            </Text>
          ) : null}
          <FieldRow label={r ? "Amount each time" : "Target"}>
            <NumberInput kind="money" label={`${name} target`} value={goal.target} min={0} onChange={(v) => onChange({ target: v })} />
          </FieldRow>
          <Divider />
          <FieldRow label="Saved so far">
            <NumberInput kind="money" label={`${name} saved so far`} value={goal.saved} min={0} onChange={(v) => onChange({ saved: v })} />
          </FieldRow>
          <Divider />
          <RecurringGoalFields goal={goal} onChange={onChange} />
          <Divider />
          {r ? (
            <View style={styles.row}>
              <Text style={[type.body, { color: t.text }]}>Sets aside</Text>
              <InfoTip text={asideInfo} label="Sets aside" open={tip} onToggle={setTip} />
              <Text style={[type.body, { color: t.text, fontWeight: "600", marginLeft: "auto", fontVariant: ["tabular-nums"] }]}>{money(aside, { whole: true })}/mo</Text>
            </View>
          ) : (
            <MonthlyAmount k={"goal:" + goal.id} label={name} />
          )}
          {r && tip ? <InfoText text={asideInfo} /> : null}
          <View style={[styles.row, { justifyContent: "flex-end" }]}>
            <IconButton icon="trash" color={t.bad} label={`Remove ${name}`} onPress={onRemove} />
          </View>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
