/**
 * What if: reach Coast FI by an age you pick. How much more a month until then, after which you could
 * stop investing and what you have grows into your FIRE number by retirement on its own.
 * The amount runs the real forecast (the extra follows your plan's steps).
 */
import { extraToCoastBy } from "@coastfi/engine";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { space, type, useTheme } from "../lib/theme";
import { Select } from "./form";
import { Card, SectionLabel } from "./ui";

export function CoastBy() {
  const t = useTheme();
  const { state, result: o, start, whatIfOn } = usePlan();
  const d = o.d;
  const ages = Array.from({ length: Math.max(0, Math.ceil(d.retireAge) - 1 - Math.floor(d.age)) }, (_, i) => Math.floor(d.age) + 1 + i);
  const [pick, setPick] = useState<number | null>(null);
  const age = pick ?? ages[Math.min(ages.length - 1, 9)] ?? null;
  const months = age === null ? 0 : Math.round((age - d.age) * 12);
  const reached = d.invested >= o.coastNow;
  const extra = useMemo(() => (age === null || reached ? 0 : extraToCoastBy(state, start, months)), [state, start, months, age === null, reached]);
  if (age === null || d.years <= 0) return null;
  const whole = (v: number) => money(v, { whole: true });
  return (
    <Card style={{ gap: space.sm }}>
      <SectionLabel>Coast FI by an age</SectionLabel>
      <Text style={[type.caption, { color: t.text3 }]}>
        Coast FI is when you could stop saving for retirement: what you have grows into your FIRE number ({whole(o.fire)}) by {d.retireAge} on its own.
      </Text>
      <View style={styles.row}>
        <Text style={[type.label, { color: t.text2, flex: 1, minWidth: 0 }]}>Reach it by</Text>
        <Select label="Coast FI by age" value={String(age)} options={ages.map((a) => ({ value: String(a), label: `Age ${a}` }))} onChange={(v) => setPick(Number(v))} />
      </View>
      {reached ? (
        <Text style={[type.label, { color: t.good, fontWeight: "700" }]}>You've already reached it ✓</Text>
      ) : extra <= 0.5 ? (
        <Text style={[type.label, { color: t.good, fontWeight: "700" }]}>Your plan already gets there by {age} ✓</Text>
      ) : (
        <View style={styles.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Until {age}</Text>
            <Text style={[type.caption, { color: t.text3 }]}>On top of your plan, every month until then. Then you could stop investing.</Text>
          </View>
          <Text style={[type.label, { color: whatIfOn ? t.warn : t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>
            {Number.isFinite(extra) ? `${whole(extra)}/mo more` : "Out of reach"}
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
});
