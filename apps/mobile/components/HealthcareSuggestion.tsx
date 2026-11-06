import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { CHILD_MONTHLY, MAX_CHARGED_CHILDREN, suggestHealthcare, suggestHousehold } from "../lib/healthcare";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, Segmented } from "./form";

/** "Not sure? Build an estimate" helper under the health insurance field: adults + children. */
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
        Retiring at {retireAge}, marketplace coverage until 65 runs roughly <Text style={{ fontWeight: "700", color: t.text }}>{money(one)}/mo per adult</Text> and
        about {money(CHILD_MONTHLY)}/mo per child (premium + typical out-of-pocket). Subsidies can lower this a lot depending on your retirement income.
      </Text>

      <View style={styles.builder}>
        <View style={{ gap: 4 }}>
          <Text style={[type.caption, { color: t.text3 }]}>Adults</Text>
          <Segmented
            label="Adults to cover"
            options={[{ value: "1", label: "Just me" }, { value: "2", label: "Me + partner" }]}
            value={String(adults) as "1" | "2"}
            onChange={(v) => setAdults(v === "2" ? 2 : 1)}
          />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={[type.caption, { color: t.text3 }]}>Children</Text>
          <View style={[styles.counter, { borderColor: t.border, backgroundColor: t.surface }]}>
            <IconButton icon="minus" label="Fewer children" disabled={children === 0} onPress={() => setChildren((c) => Math.max(0, c - 1))} />
            <Text style={[type.body, { color: t.text, fontWeight: "700", minWidth: 20, textAlign: "center", fontVariant: ["tabular-nums"] }]} aria-live="polite">
              {children}
            </Text>
            <IconButton icon="plus" label="More children" disabled={children >= 8} onPress={() => setChildren((c) => Math.min(8, c + 1))} />
          </View>
        </View>
        <View style={{ gap: 4, marginLeft: "auto" }}>
          <Text style={[type.caption, { color: t.text3 }]}>Estimate</Text>
          <Button
            title={applied ? `✓ Using ${money(total)}/mo` : `Use ${money(total)}/mo`}
            tone={applied ? "secondary" : "primary"}
            onPress={() => onUse(total)}
          />
        </View>
      </View>

      {children > 0 ? (
        <Text style={[type.caption, { color: t.text3 }]}>
          {children > MAX_CHARGED_CHILDREN ? `Plans charge for at most ${MAX_CHARGED_CHILDREN} children, so the rest are free. ` : ""}
          This assumes your kids stay on your plan the whole time; if they'll be grown and on their own before you're 65, the real cost will be lower.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, gap: space.md, marginBottom: space.sm },
  builder: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: space.lg },
  counter: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.sm, height: 44, paddingHorizontal: 2 },
});
