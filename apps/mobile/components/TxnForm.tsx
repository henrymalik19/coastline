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
import { budgetAccounts, trackingAccounts } from "../lib/register";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, NumberInput, Segmented, Select } from "./form";

type Kind = "out" | "in" | "transfer";

export function TxnForm({ txn, accountId, categoryId, initialKind, initialAmount, transferFrom, onClose }: {
  /** Change this one; missing = a new transaction. */
  txn?: Txn;
  /** Starting account / category for a new one. */
  accountId?: string;
  categoryId?: string;
  /** For a new one: money in or out, and an amount to start from (e.g. the expected paycheck). */
  initialKind?: Kind;
  initialAmount?: number;
  /** For a new transfer: the account it comes out of (can be an IRA or brokerage account: a withdrawal). */
  transferFrom?: string;
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
  const tracking = trackingAccounts(state);
  // money can come out of an investment account into checking (a withdrawal), not out of a loan
  const withdrawable = tracking.filter((a) => a.kind === "acct");
  const isTracking = (id: string) => tracking.some((a) => a.id === id);
  // a withdrawal is kept on the budget account's side: money in, from the IRA
  const withdrawal = !!txn?.transferAccountId && txn.amount > 0 && isTracking(txn.transferAccountId);
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? tracking.find((a) => a.id === id)?.name ?? "Account";

  const [kind, setKind] = useState<Kind>(txn ? (txn.transferAccountId ? "transfer" : txn.amount > 0 ? "in" : "out") : transferFrom ? "transfer" : initialKind ?? "out");
  const [amount, setAmount] = useState(Math.abs(txn?.amount ?? initialAmount ?? 0));
  const [payee, setPayee] = useState(txn?.payee ?? "");
  const [cat, setCat] = useState(txn?.categoryId ?? categoryId ?? "");
  const [acct, setAcct] = useState(withdrawal ? txn!.transferAccountId! : txn?.accountId ?? transferFrom ?? accountId ?? accounts[0]?.id ?? "");
  const [to, setTo] = useState(withdrawal ? txn!.accountId : txn?.transferAccountId ?? (transferFrom && isTracking(transferFrom) ? accounts.find((a) => a.kind === "cash")?.id ?? "" : ""));
  const [date, setDate] = useState(txn?.date ?? isoDay(new Date()));
  const [memo, setMemo] = useState(txn?.memo ?? "");
  const [cleared, setCleared] = useState(txn ? txn.cleared !== "uncleared" : false);
  const [amountText, setAmountText] = useState(txn ? String(Math.abs(txn.amount)) : initialAmount ? String(initialAmount) : "");
  const [picking, setPicking] = useState(false);
  // reconciled = matched to a bank statement: what would change the balance is locked unless you say so
  const [unlocked, setUnlocked] = useState(false);
  const locked = txn?.cleared === "reconciled" && !unlocked;
  const lockStyle = locked ? ({ opacity: 0.5, pointerEvents: "none" } as const) : null;
  // split across categories: each line's category and amount (positive); null = one category
  const [parts, setParts] = useState<{ cat: string; amount: number }[] | null>(
    txn?.splits?.length && !txn.transferAccountId ? txn.splits.map((x) => ({ cat: x.categoryId, amount: Math.abs(x.amount) })) : null,
  );
  const splitLeft = parts ? Math.round((amount - parts.reduce((a, p) => a + p.amount, 0)) * 100) / 100 : 0;
  const splitOk = !parts || (parts.length >= 2 && parts.every((p) => !!p.cat && p.amount > 0) && Math.abs(splitLeft) < 0.005);
  const setPart = (i: number, patch: Partial<{ cat: string; amount: number }>) => setParts((ps) => ps && ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removePart = (i: number) =>
    setParts((ps) => {
      if (!ps) return ps;
      const rest = ps.filter((_, j) => j !== i);
      // back to one line: that's just a category
      if (rest.length <= 1) {
        if (rest[0]?.cat) setCat(rest[0].cat);
        return null;
      }
      return rest;
    });
  // a transfer to an IRA or brokerage: the category you picked ("" = the linked one, else Unassigned)
  const [xferPick, setXferPick] = useState(txn?.transferAccountId && txn.amount < 0 && txn.categoryId && !txn.categoryId.startsWith("acct:") ? txn.categoryId : "");
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
  // a transfer to an IRA or brokerage: you pick the category (the one linked to that account, by default)
  const toInvest = kind === "transfer" && toTracking?.kind === "acct";
  const linkedCat = toInvest ? cats.find((c) => c.account === toTracking.id) : undefined;
  const xferCat = xferPick || linkedCat?.key || "ready";
  const xferLabel = xferCat === "ready" ? undefined : cats.find((c) => c.key === xferCat)?.label;
  const toLine = toTracking?.kind === "debt" ? cats.find((c) => c.key === toTracking.key) : undefined;
  const fromTracking = kind === "transfer" ? withdrawable.find((a) => a.id === acct) : undefined;
  // only a transfer can start from an investment account
  const acctOk = !!acct && (kind === "transfer" || accounts.some((a) => a.id === acct));
  const valid = amount > 0 && acctOk && (kind === "transfer" ? !!to && to !== acct && !(fromTracking && isTracking(to)) && !(fromTracking && amount > fromTracking.balance + 0.005) : parts ? splitOk : kind === "in" || !!cat);
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
    if (kind === "transfer" && fromTracking) saveTxn({ ...base, accountId: to, amount, transferAccountId: acct, categoryId: "ready", splits: undefined }, isoDay(start));
    // to a loan: its payment line; to an IRA or brokerage: the category you picked (else Unassigned)
    else if (kind === "transfer") saveTxn({ ...base, splits: undefined, transferAccountId: to, categoryId: !toTracking ? undefined : toInvest ? xferCat : toLine ? toTracking.key : "ready" }, isoDay(start));
    else if (parts) {
      const sign = kind === "in" ? 1 : -1;
      saveTxn({ ...base, transferAccountId: undefined, categoryId: undefined, splits: parts.map((p) => ({ categoryId: p.cat, amount: sign * p.amount })) }, isoDay(start));
    } else saveTxn({ ...base, transferAccountId: undefined, splits: undefined, categoryId: kind === "in" ? cat || "ready" : cat }, isoDay(start));
    onClose();
  };

  const catOptions = [
    ...(kind === "in" ? [{ value: "ready", label: "Unassigned", hint: "Income: assign it on the Budget tab" }] : []),
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
              <Pressable role="checkbox" aria-checked={cleared} disabled={locked} onPress={() => setCleared((v) => !v)} hitSlop={6} style={[styles.pill, { borderColor: cleared ? t.good : t.border, backgroundColor: cleared ? t.goodSoft : "transparent" }]}>
                <Icon name="check" size={12} color={cleared ? t.good : t.text3} />
                <Text style={[type.caption, { color: cleared ? t.good : t.text3, fontWeight: "700" }]}>Cleared</Text>
              </Pressable>
              <IconButton icon="close" label="Close" onPress={onClose} />
            </View>

            {locked ? (
              <View style={[styles.lockNote, { backgroundColor: t.surface2, borderColor: t.border }]}>
                <Text style={[type.caption, { color: t.text2, flex: 1 }]}>
                  Reconciled: this matches your bank statement, so its amount, date and account are locked. You can still change the category, payee and memo.
                </Text>
                <Pressable role="button" onPress={() => setUnlocked(true)} hitSlop={6}>
                  <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Edit anyway</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={lockStyle}>
            <Segmented
              label="Kind"
              options={[{ value: "out", label: "Spent" }, { value: "in", label: "Money in" }, { value: "transfer", label: "Transfer" }]}
              value={kind}
              onChange={(v) => {
                setKind(v);
                if (v === "in" && !cat) setCat("ready");
                if (v === "out" && cat === "ready") setCat("");
                if (v !== "transfer" && !accounts.some((a) => a.id === acct)) setAcct(accounts[0]?.id ?? "");
              }}
            />
            </View>

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
                editable={!locked}
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
                  {parts ? (
                    <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm }}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Text style={[type.body, { color: t.text2, flex: 1 }]}>Split</Text>
                        <Text style={[type.caption, { color: Math.abs(splitLeft) < 0.005 ? t.good : t.warn, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>
                          {Math.abs(splitLeft) < 0.005 ? "Adds up" : splitLeft > 0 ? `${money(splitLeft)} left to split` : `${money(-splitLeft)} over`}
                        </Text>
                      </View>
                      {parts.map((p, i) => (
                        <View key={i} style={styles.splitRow}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Select plain label={`Split line ${i + 1} category`} placeholder="Choose" value={p.cat} options={[{ value: "", label: "Choose" }, ...catOptions]} onChange={(v) => setPart(i, { cat: v })} />
                          </View>
                          <NumberInput kind="money" stepper={false} width={110} label={`Split line ${i + 1} amount`} value={p.amount} onChange={(v) => setPart(i, { amount: v })} />
                          <IconButton icon="close" label={`Remove split line ${i + 1}`} onPress={() => removePart(i)} />
                        </View>
                      ))}
                      <View style={{ flexDirection: "row", gap: space.md }}>
                        <Pressable role="button" onPress={() => setParts([...parts, { cat: "", amount: Math.max(0, splitLeft) }])} hitSlop={6}>
                          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>+ Add a line</Text>
                        </Pressable>
                        {splitLeft > 0.005 ? (
                          <Pressable role="button" onPress={() => setPart(parts.length - 1, { amount: parts[parts.length - 1]!.amount + splitLeft })} hitSlop={6}>
                            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Put the rest on the last line</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ) : (
                    <>
                      {listRow("Category", <Select plain label="Category" placeholder="Choose" value={cat} options={[{ value: "", label: "Choose" }, ...catOptions]} onChange={setCat} />)}
                      <Pressable role="button" onPress={() => setParts([{ cat, amount }, { cat: "", amount: 0 }])} hitSlop={6} style={{ alignSelf: "flex-end", paddingHorizontal: space.md, paddingBottom: space.sm }}>
                        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Split across categories</Text>
                      </Pressable>
                    </>
                  )}
                  {divider}
                </>
              ) : null}
              <View style={lockStyle}>
              {listRow(
                kind === "transfer" ? "From" : "Account",
                <Select
                  plain
                  label="Account"
                  value={acct}
                  options={[
                    ...accounts.map((a) => ({ value: a.id, label: a.name, hint: a.kind === "card" ? "Credit card · owe " + money(-a.balance) : money(a.balance) })),
                    ...(kind === "transfer" ? withdrawable.map((a) => ({ value: a.id, label: a.name, hint: `A withdrawal · ${money(a.balance)}` })) : []),
                  ]}
                  onChange={(v) => { setAcct(v); if (withdrawable.some((a) => a.id === v) && isTracking(to)) setTo(""); }}
                />,
              )}
              </View>
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
                        ...accounts.filter((x) => x.id !== acct && (!fromTracking || x.kind === "cash")).map((x) => ({ value: x.id, label: x.name, hint: x.kind === "card" ? "A card payment" : "Between budget accounts" })),
                        ...(fromTracking ? [] : tracking.map((x) => ({ value: x.id, label: x.name, hint: x.kind === "debt" ? "A loan payment" : "Counts as saving" }))),
                      ]}
                      onChange={(v) => { setTo(v); setXferPick(""); }}
                    />,
                  )}
                  {toInvest ? (
                    <>
                      {divider}
                      {listRow(
                        "Category",
                        <Select
                          plain
                          label="Category"
                          value={xferCat}
                          options={[{ value: "ready", label: "Unassigned", hint: "No category" }, ...cats.map((c) => ({ value: c.key, label: c.label, hint: c.account === to ? "Linked to this account" : c.group }))]}
                          onChange={setXferPick}
                        />,
                      )}
                    </>
                  ) : null}
                </>
              ) : null}
              {divider}
              <View style={lockStyle}>
              {listRow(
                "Date",
                <Pressable role="button" accessibilityLabel={`Date: ${dateText}. Change`} onPress={() => setPicking(true)} style={styles.selectLike}>
                  <Text style={[type.body, { color: t.text, flex: 1, textAlign: "right" }]}>{dateText}</Text>
                  <Icon name="calendar" size={14} color={t.text3} />
                </Pressable>,
              )}
              </View>
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
            {kind === "transfer" && toTracking && !fromTracking ? (
              <Text style={[type.caption, { color: t.text3 }]}>
                {toTracking.kind === "debt"
                  ? `${toLine ? `Comes out of the ${toLine.label} category` : "Comes out of Unassigned"}, and lowers what you owe on ${toTracking.name}.`
                  : `${xferLabel ? `Comes out of ${xferLabel}` : "Comes out of Unassigned"}, and adds to ${toTracking.name}.${linkedCat ? "" : " To budget for it, add a category and link it to this account."}`}
              </Text>
            ) : null}
            {fromTracking ? (
              <Text style={[type.caption, { color: t.text3 }]}>
                A withdrawal: {fromTracking.name} goes down and the money goes to Unassigned. Taxes or a penalty on it aren't taken out here.
              </Text>
            ) : null}

            {!valid ? (
              <Text style={[type.caption, { color: t.text3, textAlign: "center" }]}>
                {!(amount > 0) ? "Enter an amount" : fromTracking && amount > fromTracking.balance + 0.005 ? `${fromTracking.name} has ${money(fromTracking.balance)}. Enter that or less` : !acct ? "Choose an account" : kind === "transfer" ? (!to ? "Choose where it goes" : "Pick two different accounts") : parts ? (Math.abs(splitLeft) >= 0.005 ? "Make the split add up to the amount" : "Give each split line a category and an amount") : "Choose a category"} to save.
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
  splitRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  lockNote: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space.sm },
  suggest: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: space.md, paddingBottom: space.sm, justifyContent: "flex-end" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
