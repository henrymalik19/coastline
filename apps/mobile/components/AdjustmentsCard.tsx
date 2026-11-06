import type { AdjustmentKind } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { monthKey, newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, NumberInput, Segmented, TextField } from "./form";
import { Card, SectionLabel } from "./ui";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const KIND_TEXT: Record<AdjustmentKind, { label: string; verb: string; placeholder: string }> = {
  expense: { label: "Unexpected expense", verb: "Expense", placeholder: "e.g. Car repair" },
  incomeLoss: { label: "Lost income", verb: "Lost pay", placeholder: "e.g. Unpaid week off" },
  incomeGain: { label: "Extra income", verb: "Extra income", placeholder: "e.g. Bonus, tax refund" },
};

/** "2027-01" → "January 2027" */
export const longMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return `${MONTHS_LONG[m - 1]} ${y}`;
};

/** One-off changes to a single month (unexpected bills, lost pay, bonuses). The plan replans around them. */
export function AdjustmentsCard({ start }: { start: Date }) {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const thisMonth = monthKey(start);
  const upcoming = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    return { key: monthKey(d), short: i === 0 ? "This month" : `${MON[d.getMonth()]}${d.getMonth() === 0 || i === 1 ? ` '${String(d.getFullYear()).slice(2)}` : ""}` };
  });

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AdjustmentKind>("expense");
  const [month, setMonth] = useState(thisMonth);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");

  const list = [...(state.adjustments ?? [])].filter((a) => a.month >= thisMonth).sort((a, b) => a.month.localeCompare(b.month));
  const add = () => {
    if (amount <= 0) return;
    update((p) => {
      p.adjustments = [...(p.adjustments ?? []), { id: newId(), month, kind, amount, note: note.trim() }];
    });
    setAmount(0);
    setNote("");
    setOpen(false);
  };

  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.between}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <SectionLabel>One-off changes</SectionLabel>
          <Text style={[type.body, { color: t.text2, marginTop: -4 }]}>
            Something different this month or coming up? Add it and the plan works around it for that month only.
          </Text>
        </View>
        {!open ? <Button title="Add a change" icon="plus" onPress={() => setOpen(true)} /> : null}
      </View>

      {open ? (
        <View style={[styles.form, { backgroundColor: t.surface2 }]}>
          <Segmented
            label="Type of change"
            options={(Object.keys(KIND_TEXT) as AdjustmentKind[]).map((k) => ({ value: k, label: KIND_TEXT[k].label }))}
            value={kind}
            onChange={setKind}
          />
          <View style={{ gap: 6 }}>
            <Text style={[type.caption, { color: t.text3 }]}>Which month?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View role="radiogroup" aria-label="Month" style={{ flexDirection: "row", gap: 6 }}>
                {upcoming.map((u) => {
                  const on = u.key === month;
                  return (
                    <Pressable
                      key={u.key}
                      role="radio"
                      aria-checked={on}
                      accessibilityLabel={longMonth(u.key)}
                      onPress={() => setMonth(u.key)}
                      style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : t.surface }]}
                    >
                      <Text style={[type.caption, { color: on ? "#fff" : t.text, fontWeight: "600" }]}>{u.short}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>
          <View style={styles.row}>
            <View style={{ gap: 4 }}>
              <Text style={[type.caption, { color: t.text3 }]}>Amount</Text>
              <NumberInput kind="money" width={160} label="Amount" value={amount} onChange={setAmount} />
            </View>
            <View style={{ gap: 4, flex: 1, minWidth: 180 }}>
              <Text style={[type.caption, { color: t.text3 }]}>What is it? (optional)</Text>
              <TextField label="Note" placeholder={KIND_TEXT[kind].placeholder} value={note} onChange={setNote} />
            </View>
          </View>
          <View style={[styles.row, { justifyContent: "flex-end" }]}>
            <Button title="Cancel" tone="ghost" onPress={() => setOpen(false)} />
            <Button title={`Add to ${longMonth(month)}`} tone="primary" disabled={amount <= 0} onPress={add} />
          </View>
        </View>
      ) : null}

      {list.length ? (
        <View>
          {list.map((a) => {
            const inflow = a.kind === "incomeGain";
            return (
              <View key={a.id} style={[styles.item, { borderTopColor: t.border }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{a.note || KIND_TEXT[a.kind].label}</Text>
                  <Text style={[type.caption, { color: t.text3 }]}>{longMonth(a.month)} · {KIND_TEXT[a.kind].verb}</Text>
                </View>
                <Text style={[type.label, { color: inflow ? t.good : t.bad, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>
                  {inflow ? "+" : "−"}{money(a.amount)}
                </Text>
                <IconButton
                  icon="trash"
                  color={t.bad}
                  label={`Remove ${a.note || KIND_TEXT[a.kind].label} in ${longMonth(a.month)}`}
                  onPress={() => update((p) => { p.adjustments = (p.adjustments ?? []).filter((x) => x.id !== a.id); })}
                />
              </View>
            );
          })}
        </View>
      ) : !open ? (
        <Text style={[type.caption, { color: t.text3 }]}>No one-off changes. Your plan assumes a normal month.</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, flexWrap: "wrap" },
  form: { borderRadius: radius.md, padding: space.md, gap: space.md },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 34, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "flex-end", gap: space.md, flexWrap: "wrap" },
  item: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
