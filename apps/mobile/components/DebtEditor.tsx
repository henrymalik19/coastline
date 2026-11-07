import type { Debt, DebtKind } from "@coastfi/engine";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DEBT_KINDS, debtKind, debtLabel } from "../lib/debts";
import { money, percent } from "../lib/format";
import { Icon } from "./Icon";
import { HELP } from "../lib/help";
import { newId } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, FieldRow, IconButton, NumberInput, TextField } from "./form";
import { Card, Divider } from "./ui";

export function newDebt(kind: DebtKind): Debt {
  return { id: newId(), name: "", kind, balance: 0, apr: debtKind(kind).typicalApr, minPayment: 0 };
}

/** One debt: pick a type, optionally name it, then balance / rate / minimum. */
export function DebtEditor({ debt, onChange, onRemove }: { debt: Debt; onChange: (patch: Partial<Debt>) => void; onRemove: () => void }) {
  const t = useTheme();
  const kind = debtKind(debt.kind);
  const setKind = (k: DebtKind) => {
    // swap in the new type's typical rate only if the rate is still the old default
    const keepApr = debt.apr !== kind.typicalApr && debt.apr !== 0;
    onChange({ kind: k, ...(keepApr ? {} : { apr: debtKind(k).typicalApr }) });
  };
  // filled-in debts start collapsed (one line each); a new, blank one opens to fill in
  const [open, setOpen] = useState(() => !debt.name && !debt.balance && !debt.minPayment);
  return (
    <Card style={{ gap: space.sm, paddingVertical: open ? space.lg : space.md }}>
      <View style={styles.between}>
        <Pressable
          role="button"
          aria-expanded={open}
          accessibilityLabel={`${debtLabel(debt)} details`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((o) => !o)}
          style={[styles.between, { flex: 1, minHeight: 32 }]}
        >
          <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
            <Icon name="chevron" size={18} color={t.text3} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={[type.heading, { color: t.text }]} numberOfLines={1}>{debtLabel(debt)}</Text>
            {!open ? (
              <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
                {money(debt.balance)} · {percent(debt.apr, 1).replace(/\.0%$/, "%")} · {money(debt.minPayment)}/mo
              </Text>
            ) : null}
          </View>
        </Pressable>
        <IconButton icon="trash" color={t.bad} label={`Remove ${debtLabel(debt)}`} onPress={onRemove} />
      </View>
      {open ? (
        <>
      <View role="radiogroup" aria-label="Type of debt" style={styles.chips}>
        {DEBT_KINDS.map((k) => {
          const on = k.value === kind.value;
          return (
            <Pressable
              key={k.value}
              role="radio"
              aria-checked={on}
              onPress={() => setKind(k.value)}
              style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface }]}
            >
              <Text style={[type.caption, { color: on ? t.accent : t.text2, fontWeight: on ? "700" : "500" }]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldRow label="Name" hint="Optional, to tell debts apart">
        <TextField width={220} label="Debt name (optional)" placeholder={kind.placeholder} value={debt.name} onChange={(v) => onChange({ name: v })} />
      </FieldRow>
      <Divider />
      <FieldRow label="Balance" hint="What you still owe">
        <NumberInput kind="money" label={`${debtLabel(debt)} balance`} value={debt.balance} onChange={(v) => onChange({ balance: v })} />
      </FieldRow>
      <Divider />
      <FieldRow label="Interest rate (APR)" hint={`Typical ${kind.label.toLowerCase()}: ${(kind.typicalApr * 100).toFixed(1).replace(/\.0$/, "")}%. Use yours.`} info={HELP.apr}>
        <NumberInput kind="percent" label={`${debtLabel(debt)} APR`} value={debt.apr} max={1} onChange={(v) => onChange({ apr: v })} />
      </FieldRow>
      <Divider />
      <FieldRow label="Minimum payment" hint="Per month" info={HELP.minPayment}>
        <NumberInput kind="money" label={`${debtLabel(debt)} minimum payment`} value={debt.minPayment} onChange={(v) => onChange({ minPayment: v })} />
      </FieldRow>
      {kind.note ? (
        <View style={[styles.note, { backgroundColor: t.warnSoft }]}>
          <Text style={[type.caption, { color: t.text }]}>{kind.note}</Text>
        </View>
      ) : null}
        </>
      ) : null}
    </Card>
  );
}

/** "Add a debt" as one button per type. */
export function AddDebtButtons({ onAdd, hasAny }: { onAdd: (d: Debt) => void; hasAny: boolean }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: t.text2 }]}>{hasAny ? "Add another debt" : "Add a debt"}</Text>
      <View style={styles.chips}>
        {DEBT_KINDS.map((k) => (
          <Button key={k.value} title={k.label} icon="plus" onPress={() => onAdd(newDebt(k.value))} style={{ minHeight: 36, paddingHorizontal: space.md }} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 7, minHeight: 34, justifyContent: "center" },
  note: { borderRadius: radius.sm, padding: space.md },
});
