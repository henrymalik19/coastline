import { HSA_ELIGIBLE, hsaEligibleIn, type PlanState } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePlan } from "../lib/plan";
import { monthKey } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, MonthField, Segmented } from "./form";
import { Icon } from "./Icon";
import { monthName, useSchedule } from "./ScheduleEditor";

/** Eligible for an HSA now, or from some later month (so its settings and step still matter). */
export function hsaEverEligible(s: Pick<PlanState, "plan">): boolean {
  return !!s.plan.hsaEligible || (s.plan.schedule?.[HSA_ELIGIBLE] ?? []).some((e) => e.amount > 0);
}

/** Eligible in any month of a calendar year (that year has an HSA limit). */
export function hsaEligibleInYear(s: Pick<PlanState, "plan">, year: number): boolean {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).some((m) => hsaEligibleIn(s.plan, m));
}

/**
 * Under "I have an HSA-eligible health plan": the month that changes ("Eligible from Jan 2027", or
 * switching to a plan without an HSA). Before a change, the switch above holds.
 */
export function HsaEligibilityChanges() {
  const t = useTheme();
  const { state, start } = usePlan();
  const { list, set } = useSchedule(HSA_ELIGIBLE);
  const [open, setOpen] = useState(false);
  const now = !!state.plan.hsaEligible;
  const text = list.length
    ? list.map((e) => `${e.amount > 0 ? "Eligible" : "Not eligible"} from ${monthName(e.from)}`).join(" → ")
    : now ? "Changing health plans later?" : "Getting an HSA-eligible plan later?";
  const last = list[list.length - 1];
  const nextFrom = last
    ? monthKey(new Date(Number(last.from.slice(0, 4)), Number(last.from.slice(5, 7)), 1))
    : monthKey(new Date(start.getFullYear(), start.getMonth() + 1, 1));
  return (
    <View style={{ gap: 6, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
      <Pressable role="button" aria-expanded={open} accessibilityLabel={`HSA eligibility: ${text}`} onPress={() => setOpen((v) => !v)} hitSlop={6} style={styles.link}>
        <Text style={[type.caption, { color: list.length ? t.accent : t.text3, fontWeight: "700", flexShrink: 1 }]}>{text}</Text>
        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}> {open ? "Hide" : list.length ? "Change" : "Set the month"}</Text>
        <Icon name="chevron" size={12} color={t.accent} />
      </Pressable>
      {open ? (
        <View style={[styles.box, { backgroundColor: t.surface2 }]}>
          <View style={styles.row}>
            <Text style={[type.caption, { color: t.text2, width: 36 }]}>Now</Text>
            <Text style={[type.body, { color: t.text }]}>{now ? "Eligible" : "Not eligible"}</Text>
            <Text style={[type.caption, { color: t.text3 }]}>(the switch above)</Text>
          </View>
          {list.map((e, n) => (
            <View key={e.from + n} style={styles.row}>
              <Text style={[type.caption, { color: t.text2, width: 36 }]}>From</Text>
              <MonthField label="HSA eligibility changes" value={e.from} width={150} onChange={(v) => set(list.map((x, j) => (j === n ? { ...x, from: v } : x)))} />
              <Segmented
                label={`HSA eligibility from ${monthName(e.from)}`}
                options={[{ value: "1", label: "Eligible" }, { value: "0", label: "Not eligible" }]}
                value={e.amount > 0 ? "1" : "0"}
                onChange={(v) => set(list.map((x, j) => (j === n ? { ...x, amount: Number(v) } : x)))}
              />
              <IconButton icon="trash" label={`Remove the change from ${monthName(e.from)}`} onPress={() => set(list.filter((_, j) => j !== n))} />
            </View>
          ))}
          <View style={styles.row}>
            <Button title="Add a change" icon="plus" onPress={() => set([...list, { from: nextFrom, amount: (last ? last.amount > 0 : now) ? 0 : 1 }])} style={{ minHeight: 36 }} />
            {list.length ? <Button title="Remove all changes" tone="ghost" onPress={() => set(undefined)} style={{ minHeight: 36 }} /> : null}
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>
            The plan only puts money in your HSA in months you're eligible. A year you're eligible for part of gets the full limit here; the real limit is prorated, so check before you max it out.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  box: { borderRadius: radius.md, padding: space.sm, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
});
