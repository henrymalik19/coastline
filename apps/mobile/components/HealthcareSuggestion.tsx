import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { CHILD_MONTHLY, MAX_CHARGED_CHILDREN, suggestHealthcare, suggestHousehold } from "../lib/healthcare";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, Segmented } from "./form";
import { Icon } from "./Icon";

/** "Not sure? Estimate it" under the health insurance field: a link that opens a small estimate (adults + children). */
export function HealthcareSuggestion({ retireAge, value, onUse }: { retireAge: number; value: number; onUse: (v: number) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [adults, setAdults] = useState<1 | 2>(1);
  const [children, setChildren] = useState(0);
  const one = suggestHealthcare(retireAge);
  if (one === 0) return null;
  const total = suggestHousehold(retireAge, adults, children);
  const applied = value === total;

  if (!open) {
    return (
      <Pressable role="button" aria-expanded={false} onPress={() => setOpen(true)} hitSlop={6} style={styles.link}>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Not sure? Estimate it</Text>
        <Icon name="chevron" size={12} color={t.accent} />
      </Pressable>
    );
  }
  return (
    <View style={[styles.box, { backgroundColor: t.surface2 }]}>
      <View style={styles.row}>
        <Text style={[type.label, { color: t.text, fontWeight: "700", flex: 1 }]}>Estimate it</Text>
        <Pressable role="button" aria-expanded onPress={() => setOpen(false)} hitSlop={8}>
          <Text style={[type.caption, { color: t.text2, fontWeight: "700" }]}>Hide</Text>
        </Pressable>
      </View>
      <Text style={[type.caption, { color: t.text2 }]}>
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
  link: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginTop: -space.xs, marginBottom: space.sm },
  box: { borderRadius: radius.md, padding: space.md, gap: space.md, marginBottom: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  counter: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.sm, height: 44, paddingHorizontal: 2 },
});
