/**
 * When an account's transactions start (a cash account or a card, once the budget has started).
 * - One you keep yourself: any day you like, with its balance that day; from then on you add them.
 * - One connected to a bank: a day up to 30 days back. Its balance that day comes from the bank, and
 *   the bank's transactions from that day come in.
 * Once they've started, it says from when.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { bankStartDay, bankStartFor } from "../lib/bankTxns";
import { formatDate } from "../lib/dates";
import { pullBankTxns } from "../lib/plaid";
import { usePlan } from "../lib/plan";
import { budgetAccounts, hasRegister, todayIso } from "../lib/register";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { startTxnId } from "@coastfi/engine";
import { Button, DateField, FieldRow, NumberInput } from "./form";
import { Divider } from "./ui";

/** `divider`: a line above it (when it shows). */
export function TxnStart({ id, divider }: { id: string; divider?: boolean }) {
  const t = useTheme();
  const { state } = usePlan();
  const txns = useStore((s) => s.txns);
  const update = useStore((s) => s.update);
  const startTxns = useStore((s) => s.startTxns);
  const acct = budgetAccounts(state).find((a) => a.id === id);
  const x = state.accounts.find((a) => a.id === id) ?? state.debts.find((d) => d.id === id);
  const today = todayIso();
  const [day, setDay] = useState(today);
  const [bal, setBal] = useState<number | undefined>(undefined);
  if (!acct || !x || !state.budgetPlan) return null;
  const card = acct.kind === "card";
  const line = divider ? <Divider /> : null;

  if (hasRegister(txns, id)) {
    const start = txns.find((s) => s.id === startTxnId(id) && !s.deleted)!;
    const from = x.plaidAccountId && x.bankFrom && x.bankFrom > start.date ? x.bankFrom : start.date;
    // linked, with its own transactions already (from YNAB, or typed in): when the bank's start. Earlier
    // brings in what's missing; one that's already here (same amount, a few days apart) is matched, not doubled
    if (x.plaidAccountId && x.bankFrom)
      return (
        <>
        {line}
        <FieldRow label="Bank transactions from" info={`Transactions here start ${formatDate(start.date)}. Your bank's come in from this day (up to 30 days back); ones already here are matched, not added twice.`}>
          <DateField
            label="Bank transactions from"
            value={x.bankFrom}
            onChange={(v) => {
              if (!v) return;
              const day = bankStartDay(v < start.date ? start.date : v, today);
              update((p) => {
                const y = p.accounts.find((a) => a.id === id) ?? p.debts.find((d) => d.id === id);
                if (y) y.bankFrom = day;
              });
              void pullBankTxns();
            }}
          />
        </FieldRow>
        </>
      );
    return (
      <>
      {line}
      <Text style={[type.caption, { color: t.text3 }]}>
        Transactions from {formatDate(start.date)}
        {x.plaidAccountId && x.bankFrom ? (from === start.date ? ", from your bank" : `; from your bank since ${formatDate(from)}`) : ""}
      </Text>
      </>
    );
  }

  if (x.plaidAccountId) {
    const from = bankStartFor(state, x, today);
    return (
      <>
      {line}
      <FieldRow label="Start date" info="Up to 30 days back. Its balance that day comes from your bank, and your bank's transactions from then on come in for you to review.">
        <DateField
          label="Start date"
          value={from}
          onChange={(v) => {
            if (!v) return;
            update((p) => {
              const y = p.accounts.find((a) => a.id === id) ?? p.debts.find((d) => d.id === id);
              if (y) y.bankFrom = bankStartDay(v, today);
            });
            void pullBankTxns();
          }}
        />
      </FieldRow>
      </>
    );
  }

  // what it holds now (a card: what you owe), until you change it
  const balance = bal ?? (card ? -acct.balance : acct.balance);
  return (
    <View style={{ gap: space.sm }}>
      {line}
      <FieldRow label="Start date" info="Any day. From then on you add its transactions, and its balance comes from them.">
        <DateField label="Start date" value={day} onChange={(v) => v && setDay(v > today ? today : v)} />
      </FieldRow>
      <FieldRow label={card ? "Owed that day" : "Balance that day"}>
        <NumberInput kind="money" label={card ? "Owed that day" : "Balance that day"} value={balance} onChange={setBal} />
      </FieldRow>
      <Button title="Start its transactions" icon="plus" onPress={() => startTxns(id, day, balance)} style={{ alignSelf: "flex-start", minHeight: 36 }} />
    </View>
  );
}
