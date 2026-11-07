/**
 * An account's register: its transactions, working and cleared balance, and reconcile ("does your
 * bank say $X?"). Cash accounts and credit cards have one once the budget is started.
 */
import { registerBalance, type Txn } from "@coastfi/engine";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, NumberInput } from "../../../components/form";
import { TxnForm } from "../../../components/TxnForm";
import { Card, Divider, Pill, Screen } from "../../../components/ui";
import { categoryText, isoDay, useCategories } from "../../../lib/categories";
import { money } from "../../../lib/format";
import { usePlan } from "../../../lib/plan";
import { budgetAccounts } from "../../../lib/register";
import { newId, useStore } from "../../../lib/store";
import { space, type, useTheme } from "../../../lib/theme";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;

export default function Register() {
  const t = useTheme();
  const router = useRouter();
  const { account } = useLocalSearchParams<{ account: string }>();
  const { state, start } = usePlan();
  const txns = useStore((s) => s.txns);
  const saveTxn = useStore((s) => s.saveTxn);
  const cats = useCategories();
  const accounts = budgetAccounts(state);
  const acct = accounts.find((a) => a.id === account);
  const reg = state.budgetPlan?.registers?.[account ?? ""];
  const [editing, setEditing] = useState<Txn | "new" | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [bankSays, setBankSays] = useState(0);
  const mine = useMemo(() => txns.filter((x) => x.accountId === account && !x.deleted).sort((a, b) => (a.date === b.date ? b.updatedAt - a.updatedAt : b.date.localeCompare(a.date))), [txns, account]);
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? state.accounts.find((a) => a.id === id)?.name ?? state.debts.find((d) => d.id === id)?.name ?? "Account";

  if (!acct) {
    return (
      <Screen title="Register" back={() => router.navigate("/money/accounts")}>
        <Card><Text style={[type.body, { color: t.text2 }]}>That account isn't a cash account or credit card.</Text></Card>
      </Screen>
    );
  }
  if (!state.budgetPlan) {
    return (
      <Screen title={acct.name} back={() => router.navigate("/money/accounts")}>
        <Card style={{ gap: space.md }}>
          <Text style={[type.body, { color: t.text2 }]}>Transactions belong to your monthly budget. Start it on the Budget tab first; this account's register starts at its balance then.</Text>
          <Button title="Go to Budget" tone="primary" onPress={() => router.push("/budget")} style={{ alignSelf: "flex-start" }} />
        </Card>
      </Screen>
    );
  }

  const opening = reg?.opening ?? acct.balance;
  const working = reg ? registerBalance(opening, txns, acct.id) : acct.balance;
  const cleared = reg ? registerBalance(opening, txns, acct.id, true) : acct.balance;
  const card = acct.kind === "card";
  const show = (v: number) => (card ? `${money(-v)} owed` : money(v));

  const reconcile = () => {
    const target = card ? -bankSays : bankSays;
    const diff = Math.round((target - cleared) * 100) / 100;
    if (Math.abs(diff) > 0.004) {
      saveTxn({ id: newId(), accountId: acct.id, date: isoDay(start), amount: diff, payee: "Reconciliation adjustment", categoryId: "ready", cleared: "reconciled", source: "manual" }, isoDay(start));
    }
    // everything cleared is now reconciled
    for (const x of useStore.getState().txns.filter((y) => y.accountId === acct.id && !y.deleted && y.cleared === "cleared")) saveTxn({ ...x, cleared: "reconciled" }, isoDay(start));
    setReconciling(false);
  };

  return (
    <Screen title={acct.name} subtitle={card ? "Credit card" : "Cash account"} back={() => router.navigate("/money/accounts")} narrow>
      <Card style={{ gap: space.sm }}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: t.text3 }]}>{card ? "You owe" : "Balance"}</Text>
            <Text style={[type.display, { color: t.text, fontVariant: ["tabular-nums"] }]}>{card ? money(-working) : money(working)}</Text>
            <Text style={[type.caption, { color: t.text3 }]}>Cleared {show(cleared)} · {reg ? `register since ${dayText(reg.since)}` : "no transactions yet"}</Text>
          </View>
        </View>
        <View style={styles.row}>
          <Button title="Add a transaction" icon="plus" tone="primary" onPress={() => setEditing("new")} style={{ minHeight: 40 }} />
          <Button title="Reconcile" icon="check" onPress={() => { setBankSays(Math.round((card ? -cleared : cleared) * 100) / 100); setReconciling((v) => !v); }} style={{ minHeight: 40 }} />
        </View>
        {reconciling ? (
          <View style={{ gap: space.sm }}>
            <Divider />
            <Text style={[type.body, { color: t.text }]}>What does your bank say {card ? "you owe" : "the balance is"}, counting only what has cleared?</Text>
            <View style={styles.row}>
              <NumberInput kind="money" label="Bank balance" value={bankSays} width={160} onChange={setBankSays} />
              <Button title="Reconcile" tone="primary" onPress={reconcile} style={{ minHeight: 40 }} />
            </View>
            <Text style={[type.caption, { color: t.text3 }]}>
              {Math.abs((card ? -bankSays : bankSays) - cleared) < 0.005
                ? "It matches. Your cleared transactions get locked as reconciled."
                : `It's ${money(Math.abs((card ? -bankSays : bankSays) - cleared))} ${(card ? -bankSays : bankSays) > cleared ? "more" : "less"} than your cleared balance. Reconciling adds an adjustment to ready to assign. Check for a missing transaction first.`}
            </Text>
          </View>
        ) : null}
      </Card>

      <Card padded={false}>
        {mine.length ? (
          mine.map((x, i) => (
            <View key={x.id}>
              {i > 0 ? <Divider /> : null}
              <Pressable role="button" accessibilityLabel={`${x.payee ?? "Transaction"} ${money(x.amount)} on ${dayText(x.date)}`} onPress={() => setEditing(x)} style={({ pressed }) => [styles.txn, pressed ? { backgroundColor: t.surface2 } : null]}>
                <Pressable
                  role="checkbox"
                  aria-checked={x.cleared !== "uncleared"}
                  accessibilityLabel={x.cleared === "reconciled" ? "Reconciled" : x.cleared === "cleared" ? "Cleared: tap to unclear" : "Not cleared: tap to clear"}
                  disabled={x.cleared === "reconciled"}
                  onPress={() => saveTxn({ ...x, cleared: x.cleared === "cleared" ? "uncleared" : "cleared" }, isoDay(start))}
                  hitSlop={8}
                  style={[styles.dot, { borderColor: x.cleared === "uncleared" ? t.border : t.good, backgroundColor: x.cleared === "reconciled" ? t.good : x.cleared === "cleared" ? t.goodSoft : "transparent" }]}
                >
                  <Text style={{ color: x.cleared === "reconciled" ? "#fff" : t.good, fontSize: 10, fontWeight: "800" }}>{x.cleared === "uncleared" ? "" : x.cleared === "reconciled" ? "R" : "C"}</Text>
                </Pressable>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{x.payee || (x.transferAccountId ? "Transfer" : "No payee")}</Text>
                  <Text style={[type.caption, { color: x.categoryId || x.transferAccountId || x.splits?.length ? t.text3 : t.warn }]} numberOfLines={1}>
                    {dayText(x.date)} · {categoryText(cats, x, nameOf)}
                  </Text>
                </View>
                <Text style={[type.body, { color: x.amount > 0 ? t.good : t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{x.amount > 0 ? "+" : "−"}{money(Math.abs(x.amount))}</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <Text style={[type.body, { color: t.text2 }]}>No transactions yet.</Text>
            <Text style={[type.caption, { color: t.text3 }]}>The register starts at today's balance ({show(acct.balance)}) when you add the first one. Import from a file or YNAB is coming next.</Text>
          </View>
        )}
      </Card>
      {mine.some((x) => !x.categoryId && !x.transferAccountId && !x.splits?.length) ? <Pill tone="warn">Some transactions need a category</Pill> : null}
      {editing ? <TxnForm txn={editing === "new" ? undefined : editing} accountId={acct.id} onClose={() => setEditing(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  txn: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});
