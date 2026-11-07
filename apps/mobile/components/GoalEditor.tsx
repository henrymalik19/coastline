import type { Goal } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { space, type, useTheme } from "../lib/theme";
import { looksLikeEmergencyFund } from "./EmergencyFundNote";
import { FieldRow, IconButton, NumberInput, TextField } from "./form";
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
  const summary = `${money(goal.saved)} of ${money(goal.target)}${r ? ` · ${everyLabel(r.every)}, due ${dueLabel(r.due)}` : ""}`;
  return (
    <Card style={{ gap: space.sm, paddingVertical: open ? space.lg : space.md }}>
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
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[type.heading, { color: goal.name.trim() ? t.text : t.text3 }]} numberOfLines={1}>{name}</Text>
            {!open ? (
              <>
                <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{summary}</Text>
                {goal.target > 0 ? <ProgressBar progress={goal.saved / goal.target} color={t.series.goals} height={4} /> : null}
              </>
            ) : null}
          </View>
        </Pressable>
        <IconButton icon="trash" color={t.bad} label={`Remove ${name}`} onPress={onRemove} />
      </View>
      {open ? (
        <>
          <TextField label="Goal name" placeholder="e.g. House down payment" value={goal.name} onChange={(v) => onChange({ name: v })} />
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
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
