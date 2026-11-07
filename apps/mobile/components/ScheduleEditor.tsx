/**
 * An account's monthly plan, like a spreadsheet: "from Nov 2026: $1,500/mo → from Apr 2027: $3,500/mo".
 * Each amount runs from its month until the next change. Used on the Plan tab's account cards and on
 * the emergency fund goal (same setting, two places to see it).
 */
import type { ScheduleEntry } from "@coastfi/engine";
import { Text, View, StyleSheet } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { monthKey, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, MonthField, NumberInput } from "./form";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (key: string) => `${MON[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const sorted = (list: ScheduleEntry[]) => [...list].sort((a, b) => (a.from < b.from ? -1 : 1));

/** "Your plan: $1,500/mo from Nov 2026 → $3,500/mo from Apr 2027", or "follows your steps". */
export function scheduleSummary(list: ScheduleEntry[] | undefined): string {
  const xs = sorted(list ?? []);
  if (!xs.length) return "Your plan: follows your steps";
  return "Your plan: " + xs.map((e) => `${money(e.amount)}/mo from ${monthName(e.from)}`).join(" → ");
}

export function useSchedule(k: string) {
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const list = sorted(state.plan.schedule?.[k] ?? []);
  const set = (next: ScheduleEntry[] | undefined) =>
    update((p) => {
      const all = { ...(p.plan.schedule ?? {}) };
      if (next && next.length) all[k] = sorted(next);
      else delete all[k];
      p.plan.schedule = Object.keys(all).length ? all : undefined;
    });
  return { list, set };
}

export function ScheduleEditor({ k, label, unit = "/mo", note, onCleared }: { k: string; label: string; unit?: string; note?: string; onCleared?: () => void }) {
  const t = useTheme();
  const { start } = usePlan();
  const { list, set } = useSchedule(k);
  const last = list[list.length - 1];
  const nextFrom = last
    ? monthKey(new Date(Number(last.from.slice(0, 4)), Number(last.from.slice(5, 7)), 1))
    : monthKey(start);
  return (
    <View style={[styles.box, { backgroundColor: t.surface2 }]}>
      {list.map((e, n) => (
        <View key={e.from + n} style={styles.row}>
          <Text style={[type.caption, { color: t.text2, width: 36 }]}>From</Text>
          <MonthField label={`${label}: change starts`} value={e.from} width={150} onChange={(v) => set(list.map((x, j) => (j === n ? { ...x, from: v } : x)))} />
          <NumberInput kind="money" label={`${label} from ${monthName(e.from)}`} value={e.amount} width={130} step={100} onChange={(v) => set(list.map((x, j) => (j === n ? { ...x, amount: v } : x)))} />
          <Text style={[type.caption, { color: t.text3 }]}>{unit}</Text>
          <IconButton icon="trash" label={`Remove the change from ${monthName(e.from)}`} onPress={() => set(list.filter((_, j) => j !== n))} />
        </View>
      ))}
      <View style={styles.row}>
        <Button title={list.length ? "Add a change" : "Set a monthly amount"} icon="plus" onPress={() => set([...list, { from: nextFrom, amount: last?.amount ?? 0 }])} style={{ minHeight: 36 }} />
        {list.length ? <Button title="Follow my steps instead" tone="ghost" onPress={() => { set(undefined); onCleared?.(); }} style={{ minHeight: 36 }} /> : null}
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>
        Each amount runs from its month until your next change. It goes in before your other steps, if there's that much left after your budget. Use $0 to stop.
        {note ? ` ${note}` : ""} Shows as savings on your budget.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.sm, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
});
