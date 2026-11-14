import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { CHILD_MONTHLY, MAX_CHARGED_CHILDREN, suggestHealthcare, suggestHousehold } from "../lib/healthcare";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, Segmented } from "./form";

/** "Not sure?" under the health insurance field: a small estimate from adults + children. */
export function HealthcareSuggestion({ retireAge, value, onUse }: { retireAge: number; value: number; onUse: (v: number) => void }) {
  const t = useTheme();
  const [adults, setAdults] = useState<1 | 2>(1);
  const [children, setChildren] = useState(0);
  const one = suggestHealthcare(retireAge);
  if (one === 0) return null;
  const total = suggestHousehold(retireAge, adults, children);
  const applied = value === total;

  return (
    <View style={[styles.box, { backgroundColor: t.surface2 }]}>
      <Text style={[type.caption, { color: t.text2 }]}>
        <Text style={{ fontWeight: "700", color: t.text }}>Not sure? </Text>
        Coverage from {retireAge} to 65: about {money(one)}/mo an adult and {money(CHILD_MONTHLY)}/mo a child. Subsidies can lower it.
      </Text>

      <View style={styles.row}>
        <Text style={[type.body, { color: t.text, flex: 1 }]}>Adults</Text>
        <Segmented
          label="Adults to cover"
          options={[{ value: "1", label: "Just me" }, { value: "2", label: "Me + partner" }]}
          value={String(adults) as "1" | "2"}
          onChange={(v) => setAdults(v === "2" ? 2 : 1)}
        />
      </View>
      <View style={styles.row}>
        <Text style={[type.body, { color: t.text, flex: 1 }]}>Children</Text>
        <View style={[styles.counter, { borderColor: t.border, backgroundColor: t.surface }]}>
          <IconButton icon="minus" label="Fewer children" disabled={children === 0} onPress={() => setChildren((c) => Math.max(0, c - 1))} />
          <Text style={[type.body, { color: t.text, fontWeight: "700", minWidth: 20, textAlign: "center", fontVariant: ["tabular-nums"] }]} aria-live="polite">
            {children}
          </Text>
          <IconButton icon="plus" label="More children" disabled={children >= 8} onPress={() => setChildren((c) => Math.min(8, c + 1))} />
        </View>
      </View>
      {children > 0 ? (
        <Text style={[type.caption, { color: t.text3 }]}>
          {children > MAX_CHARGED_CHILDREN ? `Plans charge for at most ${MAX_CHARGED_CHILDREN} children. ` : ""}
          Assumes they stay on your plan until you're 65.
        </Text>
      ) : null}

      <Button
        title={applied ? `✓ Using ${money(total)}/mo` : `Use ${money(total)}/mo`}
        tone={applied ? "secondary" : "primary"}
        onPress={() => onUse(total)}
        style={{ alignSelf: "stretch" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, gap: space.md, marginBottom: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  counter: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.sm, height: 44, paddingHorizontal: 2 },
});
