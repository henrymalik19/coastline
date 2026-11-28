/**
 * An account with transactions can't just be removed (they'd be left without an account). Here you
 * close it instead (it keeps its history), or move its transactions into another account of the same
 * kind, which removes it.
 */
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { confirm } from "../lib/confirm";
import { usePlan } from "../lib/plan";
import { budgetAccounts } from "../lib/register";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { txnsInAccount } from "../lib/moveAccount";
import { Button, Select } from "./form";

export function AccountInUse({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Modal visible={!!id} transparent animationType="fade" onRequestClose={onClose}>
      {id ? <Body id={id} onClose={onClose} /> : null}
    </Modal>
  );
}

function Body({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTheme();
  const { state } = usePlan();
  const txns = useStore((s) => s.txns);
  const update = useStore((s) => s.update);
  const moveAccount = useStore((s) => s.moveAccount);
  const [to, setTo] = useState("");
  const all = budgetAccounts(state);
  const me = all.find((a) => a.id === id);
  const x = state.accounts.find((a) => a.id === id) ?? state.debts.find((d) => d.id === id);
  if (!me || !x) return null;
  const n = txnsInAccount(txns, id);
  // the same kind: cash into cash, a card into a card
  const others = all.filter((a) => a.id !== id && a.kind === me.kind);
  const close = () => {
    update((p) => {
      const y = p.accounts.find((a) => a.id === id) ?? p.debts.find((d) => d.id === id);
      if (y) y.closed = true;
    });
    onClose();
  };
  const move = async () => {
    const target = others.find((a) => a.id === to);
    if (!target) return;
    if (!(await confirm(`Move to "${target.name}"?`, `Its ${n} transaction${n === 1 ? "" : "s"} move to "${target.name}", and "${me.name}" is removed. Its starting balance goes with it: "${target.name}"'s balance comes from its own transactions.`, "Move and remove"))) return;
    moveAccount(id, target.id);
    onClose();
  };
  return (
    <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
      <Pressable onPress={() => {}} role="dialog" aria-label={`${me.name} has transactions`} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Text style={[type.heading, { color: t.text }]}>"{me.name}" has transactions</Text>
        <Text style={[type.body, { color: t.text2 }]}>
          It has {n} transaction{n === 1 ? "" : "s"}, so it can't be removed (they'd be left without an account). Close it to keep them as its history, or move them into another account.
        </Text>
        <Button title={x.closed ? "It's closed already" : "Close it"} tone="primary" disabled={!!x.closed} onPress={close} />
        {others.length ? (
          <View style={{ gap: space.sm }}>
            <Text style={[type.label, { color: t.text2 }]}>Or move them to</Text>
            <Select
              label="Move its transactions to"
              placeholder="Choose an account"
              value={to}
              options={[{ value: "", label: "Choose an account" }, ...others.map((a) => ({ value: a.id, label: a.name, hint: a.kind === "card" ? "Credit card" : "Checking & savings" }))]}
              onChange={setTo}
            />
            <Button title="Move and remove" tone="danger" disabled={!to} onPress={() => void move()} />
          </View>
        ) : null}
        <Button title="Cancel" tone="ghost" onPress={onClose} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: space.lg },
  card: { width: "100%", maxWidth: 440, borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
});
