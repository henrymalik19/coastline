/**
 * Retirement & essentials: for every spending category, whether you'd still pay it after you retire
 * (that's what builds your retirement number) and whether it's essential (what you'd keep in a money
 * emergency). One list, so you can answer it all at once.
 */
import { StyleSheet, Text, View } from "react-native";
import { InlineSwitch } from "./form";
import { Card, Divider } from "./ui";
import { groupOf, groupOrder } from "../lib/budgetOrder";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";

export function RetirementEssentials() {
  const t = useTheme();
  const { state, result } = usePlan();
  const update = useStore((s) => s.update);
  const d = result.d;
  // investing categories (money moved into an account) aren't spending, so they aren't here
  const items = state.budget.filter((b) => !b.accountId);
  const set = (id: string, patch: { inRetirement?: boolean; essential?: boolean }) =>
    update((p) => {
      const it = p.budget.find((x) => x.id === id);
      if (it) Object.assign(it, patch);
    });
  const afterRetiring = items.filter((b) => b.inRetirement).reduce((a, b) => a + b.amount, 0);
  const essential = items.filter((b) => b.essential !== false).reduce((a, b) => a + b.amount, 0);
  const groups = groupOrder(items);

  return (
    <>
      <Card style={{ gap: space.sm }}>
        <Text style={[type.body, { color: t.text2 }]}>
          For each category: would you still pay it after you retire, and is it essential (what you'd keep paying in a money emergency)?
        </Text>
        <View style={styles.totals}>
          <View style={[styles.total, { backgroundColor: t.surface2 }]}>
            <Text style={[type.title, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(afterRetiring, { whole: true })}<Text style={[type.caption, { color: t.text3 }]}>/mo</Text></Text>
            <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Still paid after retiring</Text>
            <Text style={[type.caption, { color: t.text3 }]}>Plus healthcare and home costs, this sets your retirement number ({money(result.fire, { whole: true })})</Text>
          </View>
          <View style={[styles.total, { backgroundColor: t.surface2 }]}>
            <Text style={[type.title, { color: t.text, fontVariant: ["tabular-nums"] }]}>{money(essential, { whole: true })}<Text style={[type.caption, { color: t.text3 }]}>/mo</Text></Text>
            <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Essential</Text>
            <Text style={[type.caption, { color: t.text3 }]}>Plus debt minimums ({money(d.debtMins, { whole: true })}), what emergency mode keeps paying</Text>
          </View>
        </View>
      </Card>

      <Card style={{ gap: 2 }}>
        <View style={styles.row}>
          <Text style={[type.caption, { color: t.text3, flex: 1 }]} />
          <Text style={[type.caption, styles.col, { color: t.text3 }]}>After retiring</Text>
          <Text style={[type.caption, styles.col, { color: t.text3 }]}>Essential</Text>
        </View>
        {groups.map((g, gi) => {
          const list = items.filter((b) => groupOf(b) === g);
          const sum = list.filter((b) => b.inRetirement).reduce((a, b) => a + b.amount, 0);
          return (
            <View key={g} style={{ gap: 2 }}>
              {gi > 0 ? <Divider /> : null}
              <View style={[styles.row, { marginTop: space.sm }]}>
                <Text style={[type.overline, { color: t.text2, flex: 1 }]}>{g}</Text>
                <Text style={[type.caption, { color: t.text3 }]}>{money(sum, { whole: true })}/mo after retiring</Text>
              </View>
              {list.map((b) => (
                <View key={b.id} style={styles.row}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{b.name || "Category"}</Text>
                    <Text style={[type.caption, { color: t.text3 }]}>{money(b.amount, { whole: true })}/mo</Text>
                  </View>
                  <View style={styles.col}>
                    <InlineSwitch label={`${b.name || "Category"}: still paid after you retire`} value={b.inRetirement} onChange={(v) => set(b.id, { inRetirement: v })} />
                  </View>
                  <View style={styles.col}>
                    <InlineSwitch label={`${b.name || "Category"}: essential`} value={b.essential !== false} onChange={(v) => set(b.id, { essential: v })} />
                  </View>
                </View>
              ))}
            </View>
          );
        })}
        {!items.length ? <Text style={[type.body, { color: t.text3 }]}>No spending categories yet. Add them on the Budget.</Text> : null}
      </Card>
      <Text style={[type.caption, { color: t.text3 }]}>
        Bills set aside each month come from your repeating savings goals, and investing categories (money you put into an account) aren't spending, so neither is listed here.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 4 },
  col: { width: 84, alignItems: "center", textAlign: "center" },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  total: { flexGrow: 1, flexBasis: 200, borderRadius: 10, padding: space.md, gap: 2 },
});
