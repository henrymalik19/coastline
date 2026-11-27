/**
 * What's essential: every spending category with a tick (you'd keep paying it if your income stopped).
 * It sizes your emergency fund, is what Emergency mode keeps paying, and sets your Lean FI number.
 * Shown on Emergency mode and on the emergency fund.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Icon } from "./Icon";

export function EssentialsList() {
  const t = useTheme();
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  const d = result.d;
  const extra = [d.debtMins > 0.5 ? `debt minimums (${money(d.debtMins)})` : "", d.setAsideMonthly > 0.5 ? `bills you set aside for (${money(d.setAsideMonthly)})` : ""].filter(Boolean);
  return (
    <View style={[styles.box, { backgroundColor: t.surface2 }]}>
      <Text style={[type.caption, { color: t.text3 }]}>Ticked = essential: you'd keep paying it if your income stopped. It sizes your emergency fund and sets your Lean FI number.</Text>
      {state.budget.map((b, i) => {
        if (b.accountId || b.hidden) return null; // money moved to an account (not spending), or a hidden category
        const keep = b.essential !== false;
        return (
          <Pressable
            key={b.id}
            role="checkbox"
            aria-checked={keep}
            accessibilityLabel={`${b.name || "Item"} is essential`}
            onPress={() => update((p) => { p.budget[i]!.essential = !keep; })}
            style={styles.row}
          >
            <View style={[styles.tick, { borderColor: keep ? t.accent : t.border, backgroundColor: keep ? t.accent : "transparent" }]}>
              {keep ? <Icon name="check" size={14} color="#fff" /> : null}
            </View>
            <Text style={[type.body, { color: keep ? t.text : t.text3, flex: 1 }]} numberOfLines={1}>{b.name || "Untitled item"}</Text>
            <Text style={[type.body, { color: keep ? t.text : t.text3, fontVariant: ["tabular-nums"], textDecorationLine: keep ? "none" : "line-through" }]}>{money(b.amount)}</Text>
          </Pressable>
        );
      })}
      <View style={[styles.total, { borderTopColor: t.border }]}>
        <Text style={[type.label, { color: t.text, flex: 1, fontWeight: "700" }]}>Essential costs</Text>
        <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(d.essentialExpenses)}/mo</Text>
      </View>
      {extra.length ? <Text style={[type.caption, { color: t.text3 }]}>Includes {extra.join(" and ")}.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 40 },
  tick: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  total: { flexDirection: "row", alignItems: "center", gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, marginTop: space.xs },
});
