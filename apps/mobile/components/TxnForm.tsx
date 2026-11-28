/**
 * Add or change a transaction: money out of a category, money in (to assign), or a transfer between
 * accounts. Built for quick entry on a phone: amount, payee (remembers its last category), category,
 * account, date.
 */
import { isHistoryTxn, type Txn } from "@coastfi/engine";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CalendarModal } from "./Calendar";
import { Icon } from "./Icon";
import { categoryText, isoDay, useCategories } from "../lib/categories";
import { closedName, outsideName } from "../lib/outside";
import { buildPayees, suggestPayees } from "../lib/payees";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { budgetAccounts, trackingAccounts } from "../lib/register";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, moneyText, NumberInput, Segmented, Select } from "./form";

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
  // closed ones aren't offered (unless this transaction is already in one)
  const closed = new Set([...state.accounts.filter((a) => a.closed), ...state.debts.filter((d) => d.closed)].map((x) => x.id));
  const accounts = budgetAccounts(state).filter((a) => !closed.has(a.id) || a.id === txn?.accountId || a.id === txn?.transferAccountId);
  // accounts you can transfer to: other budget accounts, and the ones the plan adds to or you owe on
  const tracking = trackingAccounts(state);
  // money can come out of an investment account into checking (a withdrawal), not out of a loan
  const withdrawable = tracking.filter((a) => a.kind === "acct");
  const isTracking = (id: string) => tracking.some((a) => a.id === id);
  // a withdrawal is kept on the budget account's side: money in, from the IRA
  const withdrawal = !!txn?.transferAccountId && txn.amount > 0 && isTracking(txn.transferAccountId);
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? tracking.find((a) => a.id === id)?.name ?? outsideName(id) ?? "Account";

  const [kind, setKind] = useState<Kind>(txn ? (txn.transferAccountId ? "transfer" : txn.amount > 0 ? "in" : "out") : transferFrom ? "transfer" : initialKind ?? "out");
  const [amount, setAmount] = useState(Math.abs(txn?.amount ?? initialAmount ?? 0));
  const [payee, setPayee] = useState(txn?.payee ?? "");
  // a payee picked from the suggestions (or one this transaction already had): no more suggestions until you type
  const [chosePayee, setChosePayee] = useState(!!txn?.payee);
  const [cat, setCat] = useState(txn?.categoryId ?? categoryId ?? "");
  const [acct, setAcct] = useState(withdrawal ? txn!.transferAccountId! : txn?.accountId ?? transferFrom ?? accountId ?? accounts[0]?.id ?? "");
  const [to, setTo] = useState(withdrawal ? txn!.accountId : txn?.transferAccountId ?? (transferFrom && isTracking(transferFrom) ? accounts.find((a) => a.kind === "cash")?.id ?? "" : ""));
  const [date, setDate] = useState(txn?.date ?? isoDay(new Date()));
  const [memo, setMemo] = useState(txn?.memo ?? "");
  const [cleared, setCleared] = useState(txn ? txn.cleared !== "uncleared" : false);
  const [amountText, setAmountText] = useState(txn ? moneyText(Math.abs(txn.amount), false) : initialAmount ? moneyText(initialAmount, false) : "");
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

  // payees you've used before: suggested as you type, and picking one fills in its last category
  const payees = useMemo(() => buildPayees(txns), [txns]);
  const pickPayee = (v: string) => {
    setPayee(v);
    if (!txn && !cat) {
      const c = payees.get(v.trim().toLowerCase())?.categoryId;
      if (c && c !== "ready") setCat(c);
    }
  };
  const typePayee = (v: string) => {
    setChosePayee(false);
    pickPayee(v);
  };
  const known = chosePayee ? [] : suggestPayees(payees, payee);
  // a name you haven't used before: saved with this transaction, then suggested next time
  const newPayee = !chosePayee && payee.trim().length >= 2 && !payees.has(payee.trim().toLowerCase()) && !known.length;

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
      // kept from an import (hidden): the category it had there
      originalCategory: txn?.originalCategory,
    };
    if (kind === "transfer" && fromTracking) saveTxn({ ...base, accountId: to, amount, transferAccountId: acct, categoryId: "ready", splits: undefined }, isoDay(start));
    // to a loan: its payment line; to an IRA or brokerage: the category you picked (else Unassigned)
    else if (kind === "transfer") saveTxn({ ...base, splits: undefined, transferAccountId: to, categoryId: !toTracking ? undefined : toInvest ? xferCat : toLine ? toTracking.key : "ready" }, isoDay(start));
    else if (parts) {
      const sign = kind === "in" ? 1 : -1;
      // a split line keeps its original category when it's the same line as before (same position)
      saveTxn(
        { ...base, transferAccountId: undefined, categoryId: undefined, splits: parts.map((p, i) => ({ categoryId: p.cat, amount: sign * p.amount, ...(txn?.splits?.[i]?.originalCategory ? { originalCategory: txn.splits[i]!.originalCategory } : {}) })) },
        isoDay(start),
      );
    } else saveTxn({ ...base, transferAccountId: undefined, splits: undefined, categoryId: kind === "in" ? cat || "ready" : cat }, isoDay(start));
    onClose();
  };

  const wasIn = new Set([txn?.categoryId, ...(txn?.splits ?? []).map((x) => x.categoryId)].filter((x): x is string => !!x));
  const catOptions = [
    ...(kind === "in" ? [{ value: "ready", label: "Income", hint: "Goes to Unassigned, for you to hand out on Budget" }] : []),
    // each category, then its sub categories ("Childcare › Babysitter")
    ...cats.filter((c) => !c.hidden && !c.parent).flatMap((c) => [
      { value: c.key, label: c.label, section: c.group },
      ...cats.filter((s) => !s.hidden && s.parent === c.key).map((s) => ({ value: s.key, label: s.label, full: `${c.label} › ${s.label}`, indent: true, section: c.group })),
    ]),
    // hidden categories are history only: listed just when this transaction is already in one (so it still shows)
    ...cats.filter((c) => c.hidden && wasIn.has(c.key)).map((c) => ({ value: c.key, label: c.label, hint: "Archived: history only" })),
  ];

  // history from a closed account: there to look back at. Only its category can change (so it shows
  // when you look for that category); it never counts in your budget, and it can't move to an account
  if (txn && isHistoryTxn(txn)) {
    const oneCat = !txn.transferAccountId && !txn.splits?.length;
    const histOptions = [
      ...(txn.amount > 0 ? [{ value: "ready", label: "Income", hint: "Money in" }] : []),
      ...catOptions.filter((o) => o.value !== "ready"),
      ...cats.filter((c) => c.hidden && !wasIn.has(c.key)).map((c) => ({ value: c.key, label: c.label, hint: "Archived" })),
    ];
    const detail = (k: string, v: string) => (
      <View style={styles.listRow}>
        <Text style={[type.body, { color: t.text2, width: 84 }]}>{k}</Text>
        <Text style={[type.body, { color: t.text, flex: 1, textAlign: "right" }]}>{v}</Text>
      </View>
    );
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
          <Pressable onPress={() => {}} aria-label="Old transaction" style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
            <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
              <View style={styles.head}>
                <Text style={[type.heading, { color: t.text, flex: 1 }]}>Old transaction</Text>
                <IconButton icon="close" label="Close" onPress={onClose} />
              </View>
              <Text style={[type.caption, { color: t.text3 }]}>
                History from a closed account you didn't bring in: it never counts in your budget. You can change its category.
              </Text>
              <View style={[styles.list, { borderColor: t.border }]}>
                {detail("Date", dateText)}
                {divider}
                {txn.transferAccountId ? (
                  // a transfer: where the money left and where it went
                  <>
                    {detail("From", txn.amount < 0 ? closedName(txn.accountId) ?? "" : nameOf(txn.transferAccountId))}
                    {divider}
                    {detail("To", txn.amount < 0 ? nameOf(txn.transferAccountId) : closedName(txn.accountId) ?? "")}
                  </>
                ) : (
                  <>
                    {detail("Account", closedName(txn.accountId) ?? "")}
                    {divider}
                    {detail("Payee", txn.payee || "No payee")}
                  </>
                )}
                {divider}
                {detail("Amount", `${txn.transferAccountId ? "" : txn.amount > 0 ? "+" : "−"}${money(Math.abs(txn.amount))}`)}
                {txn.memo ? <>{divider}{detail("Memo", txn.memo)}</> : null}
                {txn.splits?.length ? <>{divider}{detail("Split", categoryText(cats, txn, nameOf))}</> : null}
              </View>
              {oneCat || txn.categoryId ? (
                <Select label="Category" placeholder="No category" value={cat} options={[{ value: "", label: "No category" }, ...histOptions]} onChange={setCat} />
              ) : null}
              <View style={{ flexDirection: "row", gap: space.sm, justifyContent: "flex-end" }}>
                <Button title="Cancel" onPress={onClose} />
                <Button title="Save" tone="primary" disabled={cat === (txn.categoryId ?? "")} onPress={() => { saveTxn({ ...txn, categoryId: cat || undefined }, isoDay(start)); onClose(); }} />
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

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
                onBlur={() => setAmountText(amount ? moneyText(amount, false) : "")}
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
                      onChangeText={typePayee}
                      placeholder={kind === "in" ? "e.g. Hub paycheck" : "e.g. Costco"}
                      placeholderTextColor={t.text3}
                      style={[type.body, styles.inline, { color: t.text }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
                    />,
                  )}
                  {known.length ? (
                    <View style={[styles.suggest]}>
                      {known.map((p) => (
                        <Pressable key={p.name} role="button" accessibilityLabel={`Use ${p.name}`} onPress={() => { setChosePayee(true); pickPayee(p.name); }} style={[styles.chip, { borderColor: t.border, backgroundColor: t.surface }]}>
                          {/* a long name (a bank's Zelle line): cut at the end, not the start */}
                          <Text numberOfLines={1} ellipsizeMode="tail" style={[type.caption, { color: t.text2 }]}>{p.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : newPayee ? (
                    <View style={[styles.suggest]}>
                      <Text style={[type.caption, { color: t.text3 }]}>New payee: it'll be suggested next time.</Text>
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
                    ...[...accounts].sort((a, b) => Number(a.kind === "card") - Number(b.kind === "card")).map((a) => ({ value: a.id, label: a.name, hint: a.kind === "card" ? "Owe " + money(-a.balance) : money(a.balance), section: a.kind === "card" ? "Credit cards" : "Checking & savings" })),
                    ...(kind === "transfer" ? withdrawable.map((a) => ({ value: a.id, label: a.name, hint: `A withdrawal · ${money(a.balance)}`, section: "Retirement & investments" })) : []),
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
                        ...accounts.filter((x) => x.id !== acct && (!fromTracking || x.kind === "cash")).sort((a, b) => Number(a.kind === "card") - Number(b.kind === "card")).map((x) => ({ value: x.id, label: x.name, hint: x.kind === "card" ? "A card payment" : "Between budget accounts", section: x.kind === "card" ? "Credit cards" : "Checking & savings" })),
                        ...(fromTracking ? [] : [...tracking].sort((a, b) => Number(a.kind === "debt") - Number(b.kind === "debt")).map((x) => ({ value: x.id, label: x.name, hint: x.kind === "debt" ? "A loan payment" : "Counts as saving", section: x.kind === "debt" ? "Loans" : "Retirement & investments" }))),
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
                          options={[{ value: "ready", label: "Unassigned", hint: "No category" }, ...cats.filter((c) => !c.hidden).map((c) => ({ value: c.key, label: c.label, hint: c.account === to ? "Linked to this account" : c.group }))]}
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
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: "100%", flexShrink: 1 },
});
