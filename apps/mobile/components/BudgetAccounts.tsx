/**
 * The Budget tab's Accounts view: the accounts you budget from (checking & savings, credit cards),
 * each opening its transactions, and (folded away) the ones you only track: retirement and
 * investments, which a transfer can add to or withdraw from. Drag a grip to reorder; it's the same
 * order as Money → Accounts.
 */
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DragList, reorderAmong } from "./DragList";
import { Button, InfoText, InfoTip } from "./form";
import { Icon } from "./Icon";
import { Card, Divider } from "./ui";
import { money } from "../lib/format";
import { usePlan } from "../lib/plan";
import { budgetAccounts, isCard, trackingAccounts } from "../lib/register";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";

const TRACKING_TIP =
  "Not in your budget: their balances only change when you move money. Withdraw records money coming out into checking (it goes to Unassigned); a transfer to one from checking adds to it.";

export function BudgetAccounts({ onAdd, onTransfer }: { onAdd: () => void; onTransfer: (from: string) => void }) {
  const t = useTheme();
  const router = useRouter();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const txns = useStore((s) => s.txns);
  const [showTracking, setShowTracking] = useState(false);
  const [tip, setTip] = useState(false);
  const all = budgetAccounts(state);
  const cash = all.filter((a) => a.kind === "cash");
  const cards = all.filter((a) => a.kind === "card");
  const tracking = trackingAccounts(state).filter((a) => a.kind === "acct");
  const count = (id: string) => txns.filter((x) => !x.deleted && x.accountId === id).length;
  const cashTotal = cash.reduce((s, a) => s + (+a.balance || 0), 0);
  const owed = cards.reduce((s, a) => s - a.balance, 0);

  const head = (label: string, value: string, extra?: ReactNode) => (
    <View style={styles.head}>
      <Text style={[type.overline, { color: t.text3, flex: 1 }]}>{label}</Text>
      {extra}
      <Text style={[type.caption, { color: t.text3, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  );
  const row = (a: { id: string; name: string; kind: "cash" | "card"; balance: number }, n: number, grip: ReactNode, many: boolean) => (
    <View>
      {n > 0 ? <Divider /> : null}
      <View style={styles.row}>
        {many ? grip : null}
        <Pressable
          role="link"
          accessibilityLabel={`${a.name}: transactions`}
          onPress={() => router.push(`/money/register?account=${a.id}`)}
          style={(st) => [styles.link, { opacity: st.pressed ? 0.7 : 1 }]}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[type.body, { color: t.text, fontWeight: "500" }]}>{a.name}</Text>
            <Text numberOfLines={1} style={[type.caption, { color: t.text3 }]}>{count(a.id)} transaction{count(a.id) === 1 ? "" : "s"}</Text>
          </View>
          <Text style={[type.body, { color: a.balance < 0 && a.kind === "cash" ? t.bad : t.text, fontVariant: ["tabular-nums"] }]}>
            {a.kind === "card" ? `${money(-a.balance)} owed` : money(a.balance)}
          </Text>
          <Icon name="chevron" size={14} color={t.text3} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={{ gap: space.md }}>
      <View style={[styles.head, { justifyContent: "flex-end" }]}>
        <Button title="Add a transaction" icon="plus" tone="primary" onPress={onAdd} style={{ minHeight: 36 }} />
      </View>

      {cash.length ? (
        <View style={{ gap: space.xs }}>
          {head("Checking & savings", money(cashTotal))}
          <Card style={{ paddingVertical: space.xs }}>
            <DragList
              count={cash.length}
              keyOf={(n) => cash[n]!.id}
              nameOf={(n) => cash[n]!.name}
              onMove={(from, to) => update((p) => { p.accounts = reorderAmong(p.accounts, (a) => a.type === "cash", from, to); })}
              renderItem={(n, grip) => row(cash[n]!, n, grip, cash.length > 1)}
            />
          </Card>
        </View>
      ) : null}

      {cards.length ? (
        <View style={{ gap: space.xs }}>
          {head("Credit cards", `${money(owed)} owed`)}
          <Card style={{ paddingVertical: space.xs }}>
            <DragList
              count={cards.length}
              keyOf={(n) => cards[n]!.id}
              nameOf={(n) => cards[n]!.name}
              onMove={(from, to) => update((p) => { p.debts = reorderAmong(p.debts, isCard, from, to); })}
              renderItem={(n, grip) => row(cards[n]!, n, grip, cards.length > 1)}
            />
          </Card>
        </View>
      ) : null}

      {!all.length ? (
        <Card>
          <Text style={[type.caption, { color: t.text3 }]}>Add a cash account under Money → Accounts, or a credit card under Money → Debts, to track transactions.</Text>
        </Card>
      ) : (
        <Text style={[type.caption, { color: t.text3, paddingHorizontal: space.xs }]}>
          Tap an account for its transactions. Drag a grip to reorder. A credit card missing? Set its type to Credit card under Money → Debts.
        </Text>
      )}

      {tracking.length ? (
        <View style={{ gap: space.xs }}>
          <View style={[styles.head, { minHeight: 36 }]}>
            <Pressable
              role="button"
              aria-expanded={showTracking}
              accessibilityLabel={`Tracking accounts: retirement and investments, ${showTracking ? "hide" : "show"}`}
              onPress={() => setShowTracking((v) => !v)}
              style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36 }}
            >
              <View style={{ transform: [{ rotate: showTracking ? "90deg" : "0deg" }] }}>
                <Icon name="chevron" size={14} color={t.text3} />
              </View>
              <Text style={[type.overline, { color: t.text3 }]}>Tracking · retirement & investments</Text>
            </Pressable>
            <InfoTip text={TRACKING_TIP} label="tracking accounts" open={tip} onToggle={setTip} />
            <View style={{ flex: 1 }} />
            <Text style={[type.caption, { color: t.text3, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(tracking.reduce((s, a) => s + (+a.balance || 0), 0))}</Text>
          </View>
          {tip ? <InfoText text={TRACKING_TIP} /> : null}
          {showTracking ? (
            <Card style={{ paddingVertical: space.xs, gap: space.xs }}>
              {tracking.map((a, n) => (
                <View key={a.id}>
                  {n > 0 ? <Divider /> : null}
                  <View style={styles.row}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={[type.body, { color: t.text }]}>{a.name}</Text>
                      <Text style={[type.body, { color: t.text2, fontVariant: ["tabular-nums"] }]}>{money(a.balance)}</Text>
                    </View>
                    <Button title="Withdraw" onPress={() => onTransfer(a.id)} style={{ minHeight: 34 }} />
                  </View>
                </View>
              ))}
            </Card>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm },
  link: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 40 },
});
