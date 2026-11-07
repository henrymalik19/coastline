/**
 * Add or change a transaction: money out of a category, money in (to assign), or a transfer between
 * accounts. Built for quick entry on a phone: amount, payee (remembers its last category), category,
 * account, date.
 */
import type { Txn } from "@coastfi/engine";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CalendarModal } from "./Calendar";
import { Icon } from "./Icon";
import { categoryText, isoDay, useCategories } from "../lib/categories";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { budgetAccounts, isCard } from "../lib/register";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, Segmented, Select } from "./form";

type Kind = "out" | "in" | "transfer";

export function TxnForm({ txn, accountId, categoryId, onClose }: {
  /** Change this one; missing = a new transaction. */
  txn?: Txn;
  /** Starting account / category for a new one. */
  accountId?: string;
  categoryId?: string;
  onClose: () => void;
}) {
  const t = useTheme();
  const { state, start } = usePlan();
  const txns = useStore((s) => s.txns);
  const saveTxn = useStore((s) => s.saveTxn);
  const deleteTxn = useStore((s) => s.deleteTxn);
  const cats = useCategories();
  const accounts = budgetAccounts(state);
  // accounts you can transfer to: other budget accounts, and the ones the plan adds to or you owe on
  const tracking = [
    ...state.accounts.filter((a) => a.type !== "cash" && a.type !== "property").map((a) => ({ id: a.id, name: a.name.trim() || "Account", key: "acct:" + a.id })),
    ...state.debts.filter((d) => !isCard(d) && d.balance > 0 && !d.payroll).map((d) => ({ id: d.id, name: d.name?.trim() || "Loan", key: "debt:" + d.id })),
  ];
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? tracking.find((a) => a.id === id)?.name ?? "Account";

  const [kind, setKind] = useState<Kind>(txn ? (txn.transferAccountId ? "transfer" : txn.amount > 0 ? "in" : "out") : "out");
  const [amount, setAmount] = useState(Math.abs(txn?.amount ?? 0));
  const [payee, setPayee] = useState(txn?.payee ?? "");
  const [cat, setCat] = useState(txn?.categoryId ?? categoryId ?? "");
  const [acct, setAcct] = useState(txn?.accountId ?? accountId ?? accounts[0]?.id ?? "");
  const [to, setTo] = useState(txn?.transferAccountId ?? "");
  const [date, setDate] = useState(txn?.date ?? isoDay(new Date()));
  const [memo, setMemo] = useState(txn?.memo ?? "");
  const [cleared, setCleared] = useState(txn ? txn.cleared !== "uncleared" : false);
  const [amountText, setAmountText] = useState(txn ? String(Math.abs(txn.amount)) : "");
  const [picking, setPicking] = useState(false);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateText = date === isoDay(new Date()) ? "Today" : `${MON[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
  const divider = <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: space.md }} />;
  const listRow = (labelText: string, control: React.ReactNode) => (
    <View style={styles.listRow}>
      <Text style={[type.body, { color: t.text2, width: 84 }]}>{labelText}</Text>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", justifyContent: "flex-end" }}>{control}</View>
    </View>
  );

  // a payee you've used before suggests its last category
  const payees = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const x of [...txns].filter((y) => !y.deleted && y.payee).sort((a, b) => a.updatedAt - b.updatedAt)) m.set(x.payee!.trim().toLowerCase(), x.categoryId);
    return m;
  }, [txns]);
  const pickPayee = (v: string) => {
    setPayee(v);
    if (!txn && !cat) {
      const c = payees.get(v.trim().toLowerCase());
      if (c && c !== "ready") setCat(c);
    }
  };
  const known = payee.trim().length >= 2 ? [...payees.keys()].filter((p) => p.startsWith(payee.trim().toLowerCase()) && p !== payee.trim().toLowerCase()).slice(0, 3) : [];

  const toTracking = tracking.find((a) => a.id === to);
  const valid = amount > 0 && !!acct && (kind === "transfer" ? !!to && to !== acct : kind === "in" || !!cat);
  const save = () => {
    if (!valid) return;
    const base = {
      id: txn?.id ?? newId(),
      accountId: acct,
      date,
      amount: kind === "in" ? amount : -amount,
      payee: payee.trim() || undefined,
      memo: memo.trim() || undefined,
      cleared: (cleared ? (txn?.cleared === "reconciled" ? "reconciled" : "cleared") : "uncleared") as Txn["cleared"],
      source: txn?.source ?? ("manual" as const),
      importId: txn?.importId,
      transferId: txn?.transferId,
    };
    if (kind === "transfer") saveTxn({ ...base, transferAccountId: to, categoryId: toTracking?.key }, isoDay(start));
    else saveTxn({ ...base, transferAccountId: undefined, categoryId: kind === "in" ? cat || "ready" : cat }, isoDay(start));
    onClose();
  };

  const catOptions = [
    ...(kind === "in" ? [{ value: "ready", label: "Ready to assign", hint: "Income: give it a job on the Budget tab" }] : []),
    ...cats.map((c) => ({ value: c.key, label: c.label, hint: c.group })),
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable onPress={() => {}} aria-label={txn ? "Change transaction" : "Add a transaction"} style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
            {/* header: title, cleared, close */}
            <View style={styles.head}>
              <Text style={[type.heading, { color: t.text, flex: 1 }]}>{txn ? "Edit transaction" : "New transaction"}</Text>
              <Pressable role="checkbox" aria-checked={cleared} onPress={() => setCleared((v) => !v)} hitSlop={6} style={[styles.pill, { borderColor: cleared ? t.good : t.border, backgroundColor: cleared ? t.goodSoft : "transparent" }]}>
                <Icon name="check" size={12} color={cleared ? t.good : t.text3} />
                <Text style={[type.caption, { color: cleared ? t.good : t.text3, fontWeight: "700" }]}>Cleared</Text>
              </Pressable>
              <IconButton icon="close" label="Close" onPress={onClose} />
            </View>

            <Segmented
              label="Kind"
              options={[{ value: "out", label: "Spent" }, { value: "in", label: "Money in" }, { value: "transfer", label: "Transfer" }]}
              value={kind}
              onChange={(v) => { setKind(v); if (v === "in" && !cat) setCat("ready"); if (v === "out" && cat === "ready") setCat(""); }}
            />

            {/* the amount, big */}
            <View style={styles.amountWrap}>
              <Text style={[styles.amountSign, { color: kind === "in" ? t.good : kind === "out" ? t.text : t.accent }]}>{kind === "in" ? "+$" : kind === "out" ? "−$" : "$"}</Text>
              <TextInput
                accessibilityLabel="Amount"
                value={amountText}
                onChangeText={(v) => { const clean = v.replace(/[^0-9.]/g, ""); setAmountText(clean); setAmount(Number(clean) || 0); }}
                onBlur={() => setAmountText(amount ? String(+amount.toFixed(2)) : "")}
                placeholder="0"
                placeholderTextColor={t.text3}
                keyboardType="decimal-pad"
                autoFocus={!txn}
                style={[styles.amount, { color: kind === "in" ? t.good : t.text, width: Math.min(260, 30 * Math.max(1, (amountText || "0").length) + 12) }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
              />
            </View>

            {/* details, one per row */}
            <View style={[styles.list, { borderColor: t.border, backgroundColor: t.surface2 }]}>
              {kind !== "transfer" ? (
                <>
                  {listRow(
                    kind === "in" ? "From" : "Payee",
                    <TextInput
                      accessibilityLabel={kind === "in" ? "From (payer)" : "Payee"}
                      value={payee}
                      onChangeText={pickPayee}
                      placeholder={kind === "in" ? "e.g. Hub paycheck" : "e.g. Costco"}
                      placeholderTextColor={t.text3}
                      style={[type.body, styles.inline, { color: t.text }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
                    />,
                  )}
                  {known.length ? (
                    <View style={[styles.suggest]}>
                      {known.map((p) => (
                        <Pressable key={p} role="button" onPress={() => pickPayee(p.replace(/\b\w/g, (c) => c.toUpperCase()))} style={[styles.chip, { borderColor: t.border, backgroundColor: t.surface }]}>
                          <Text style={[type.caption, { color: t.text2 }]}>{p}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {divider}
                  {listRow("Category", <Select plain label="Category" placeholder="Choose" value={cat} options={[{ value: "", label: "Choose" }, ...catOptions]} onChange={setCat} />)}
                  {divider}
                </>
              ) : null}
              {listRow(kind === "transfer" ? "From" : "Account", <Select plain label="Account" value={acct} options={accounts.map((a) => ({ value: a.id, label: a.name, hint: a.kind === "card" ? "Credit card · owe " + money(-a.balance) : money(a.balance) }))} onChange={setAcct} />)}
              {kind === "transfer" ? (
                <>
                  {divider}
                  {listRow(
                    "To",
                    <Select
                      plain
                      label="Transfer to"
                      placeholder="Choose"
                      value={to}
                      options={[
                        { value: "", label: "Choose" },
                        ...accounts.filter((x) => x.id !== acct).map((x) => ({ value: x.id, label: x.name, hint: x.kind === "card" ? "A card payment" : "Between budget accounts" })),
                        ...tracking.map((x) => ({ value: x.id, label: x.name, hint: x.key.startsWith("debt:") ? "A loan payment" : "Counts as saving" })),
                      ]}
                      onChange={setTo}
                    />,
                  )}
                </>
              ) : null}
              {divider}
              {listRow(
                "Date",
                <Pressable role="button" accessibilityLabel={`Date: ${dateText}. Change`} onPress={() => setPicking(true)} style={styles.selectLike}>
                  <Text style={[type.body, { color: t.text, flex: 1, textAlign: "right" }]}>{dateText}</Text>
                  <Icon name="calendar" size={14} color={t.text3} />
                </Pressable>,
              )}
              {divider}
              {listRow(
                "Memo",
                <TextInput
                  accessibilityLabel="Memo"
                  value={memo}
                  onChangeText={setMemo}
                  placeholder="Optional"
                  placeholderTextColor={t.text3}
                  style={[type.body, styles.inline, { color: t.text }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
                />,
              )}
            </View>
            {kind === "transfer" && toTracking ? (
              <Text style={[type.caption, { color: t.text3 }]}>Comes out of the {cats.find((c) => c.key === toTracking.key)?.label ?? toTracking.name} category.</Text>
            ) : null}

            {!valid ? (
              <Text style={[type.caption, { color: t.text3, textAlign: "center" }]}>
                {!(amount > 0) ? "Enter an amount" : !acct ? "Choose an account" : kind === "transfer" ? (!to ? "Choose where it goes" : "Pick two different accounts") : "Choose a category"} to save.
              </Text>
            ) : null}
            <Button title={txn ? "Save changes" : "Save"} tone="primary" disabled={!valid} onPress={save} style={{ minHeight: 48 }} />
            {txn ? (
              <Pressable role="button" onPress={() => { deleteTxn(txn.id); onClose(); }} hitSlop={6} style={{ alignSelf: "center", padding: 6 }}>
                <Text style={[type.label, { color: t.bad, fontWeight: "700" }]}>Delete transaction</Text>
              </Pressable>
            ) : null}
          </ScrollView>
          {picking ? <CalendarModal visible title="Date" value={date} onClose={() => setPicking(false)} onPick={(iso) => { setDate(iso); setPicking(false); }} /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: space.md },
  sheet: { width: "100%", maxWidth: 480, maxHeight: "92%", borderRadius: radius.lg, borderWidth: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  amountWrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: space.sm },
  amountSign: { fontSize: 36, fontWeight: "700", marginRight: 2 },
  amount: { fontSize: 44, fontWeight: "800", textAlign: "left", fontVariant: ["tabular-nums"], paddingVertical: 4 },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: "hidden" },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, minHeight: 50 },
  inline: { flex: 1, textAlign: "right", paddingVertical: 12 },
  selectLike: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, flex: 1 },
  suggest: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: space.md, paddingBottom: space.sm, justifyContent: "flex-end" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
