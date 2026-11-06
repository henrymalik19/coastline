import { Pressable, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { suggestHealthcare } from "../lib/healthcare";
import { radius, space, type, useTheme } from "../lib/theme";

/** "Not sure? Use an estimate" helper under the health insurance field. */
export function HealthcareSuggestion({ retireAge, value, onUse }: { retireAge: number; value: number; onUse: (v: number) => void }) {
  const t = useTheme();
  const one = suggestHealthcare(retireAge);
  if (one === 0) return null;
  const options = [
    { label: "Just me", v: one },
    { label: "Me + partner", v: one * 2 },
  ];
  return (
    <View style={[styles.box, { backgroundColor: t.surface2 }]}>
      <Text style={[type.caption, { color: t.text2 }]}>
        <Text style={{ fontWeight: "700", color: t.text }}>Not sure? </Text>
        Retiring at {retireAge}, coverage until 65 costs roughly <Text style={{ fontWeight: "700", color: t.text }}>{money(one)}/mo per person</Text> on the
        marketplace (premium + typical out-of-pocket). Subsidies can lower this a lot depending on your retirement income.
      </Text>
      <View style={styles.row}>
        {options.map((o) => {
          const on = value === o.v;
          return (
            <Pressable
              key={o.label}
              role="button"
              accessibilityLabel={`Use ${money(o.v)} a month, ${o.label}`}
              onPress={() => onUse(o.v)}
              style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }]}
            >
              <Text style={[type.caption, { color: on ? t.accent : t.text, fontWeight: "600" }]}>
                {on ? "✓ " : "Use "}
                {money(o.v)} · {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, gap: space.sm, marginBottom: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 7, minHeight: 34, justifyContent: "center" },
});
