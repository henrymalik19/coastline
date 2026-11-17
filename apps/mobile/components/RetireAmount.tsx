import { useState } from "react";
import { Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { Button, FieldRow, NumberInput } from "./form";

/**
 * Type a yearly retirement amount instead of building it from the budget (setup's budget step, and the
 * "Add your budget" card). Closed, it's a single link; once an amount is set it shows the field.
 */
export function SetRetirementAmount({
  prompt = "Know what you'll spend in retirement? Set a yearly amount instead",
  confirm,
}: {
  prompt?: string;
  /** Save only on "Use this amount" (where saving makes this card go away, so a typing pause mustn't). */
  confirm?: boolean;
}) {
  const t = useTheme();
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  const set = (state.retireSpending ?? 0) > 0;
  const [open, setOpen] = useState(set);
  const [draft, setDraft] = useState(0);
  const link = (label: string, onPress: () => void) => (
    <Text role="link" style={[type.caption, { color: t.accent, fontWeight: "700", alignSelf: "flex-start" }]} onPress={onPress}>
      {label}
    </Text>
  );

  if (!open) return link(prompt, () => setOpen(true));
  if (confirm)
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
        <View style={{ width: 180 }}>
          <NumberInput kind="money" label="Yearly retirement spending" value={draft} onChange={setDraft} />
        </View>
        <Button title="Use this amount" disabled={draft <= 0} onPress={() => update((p) => { p.retireSpending = draft; })} />
        <Text style={[type.caption, { color: t.text3, flexBasis: "100%" }]}>A year, in today's dollars, healthcare from 65 included.</Text>
      </View>
    );
  return (
    <View style={{ gap: space.xs }}>
      <FieldRow
        label="Yearly retirement spending"
        hint="Today's dollars, healthcare from 65 included"
        info="Everything you'll spend in a year once retired. Your plan uses this instead of adding up the budget. Social Security and pensions still come off it. Change it any time in Money → What you'll spend."
      >
        <NumberInput kind="money" label="Yearly retirement spending" value={state.retireSpending ?? 0} onChange={(v) => update((p) => { p.retireSpending = v > 0 ? v : undefined; })} />
      </FieldRow>
      {set
        ? link(`Use my budget instead (${money(result.d.retireMonthlyBudget * 12, { whole: true })}/yr)`, () => {
            update((p) => { p.retireSpending = undefined; });
            setOpen(false);
          })
        : null}
    </View>
  );
}
