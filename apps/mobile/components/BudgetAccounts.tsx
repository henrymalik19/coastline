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
import { accountTxnsHref, budgetAccounts, isCard, todayIso, trackingAccounts } from "../lib/register";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { sticky } from "../lib/sticky";
import { useLayout } from "../lib/layout";
import { ReorderToggle } from "./ReorderToggle";

const TRACKING_TIP =
  "Your retirement and investment accounts. Not in your budget: their balances only change when you move money. Withdraw records money coming out into checking (it goes to Unassigned); a transfer to one from checking adds to it.";

export function BudgetAccounts({ onTransfer, stickyTop = 0 }: { onTransfer: (from: string) => void; /** Where its headings stop, under the Budget's toolbar. */ stickyTop?: number }) {
  const t = useTheme();
  const router = useRouter();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const txns = useStore((s) => s.txns);
  const [showTracking, setShowTracking] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [tip, setTip] = useState(false);
  // phones: the drag grips only while reordering (so a scroll doesn't move an account by accident)
  const compact = useLayout().contentWidth < 600;
  const [reorder, setReorder] = useState(false);
  const grips = !compact || reorder;
  const toggle = compact ? <ReorderToggle on={reorder} onChange={setReorder} what="accounts" /> : null;
  const everything = budgetAccounts(state);
  // closed at the bank: folded away at the bottom (their history is still there)
  const closedIds = new Set([...state.accounts.filter((a) => a.closed), ...state.debts.filter((d) => d.closed)].map((x) => x.id));
  const all = everything.filter((a) => !closedIds.has(a.id));
  const closedList = everything.filter((a) => closedIds.has(a.id));
  const cash = all.filter((a) => a.kind === "cash");
  const cards = all.filter((a) => a.kind === "card");
  const linked = new Set([...state.accounts, ...state.debts].flatMap((x) => (x.plaidAccountId ? [x.id] : [])));
  const today = todayIso();
  /** Cleared so far (what the bank shows), and how many are waiting for you to review. */
  const cleared = (id: string) => txns.reduce((s, x) => (!x.deleted && x.accountId === id && x.cleared !== "uncleared" && !x.review && x.date <= today ? s + x.amount : s), 0);
  const toReview = (id: string) => txns.filter((x) => !x.deleted && x.accountId === id && x.review).length;
  const tracking = trackingAccounts(state).filter((a) => a.kind === "acct");
  const count = (id: string) => txns.filter((x) => !x.deleted && x.accountId === id).length;
  const cashTotal = cash.reduce((s, a) => s + (+a.balance || 0), 0);
  const owed = cards.reduce((s, a) => s - a.balance, 0);

  const head = (label: string, value: string, extra?: ReactNode) => (
    <View style={[styles.head, sticky(stickyTop, t.bg)]}>
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
          onPress={() => router.push(accountTxnsHref(a.id) as never)}
          style={(st) => [styles.link, { opacity: st.pressed ? 0.7 : 1 }]}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[type.body, { color: t.text, fontWeight: "500" }]}>{a.name}</Text>
            <Text numberOfLines={1} style={[type.caption, { color: t.text3 }]}>
              {count(a.id)
                ? a.kind === "card"
                  ? state.cardsCovered?.[a.id] ? `Payment set aside ${money(state.cardsCovered[a.id]!)}` : `Cleared ${money(-cleared(a.id))} owed`
                  : `Cleared ${money(cleared(a.id))}`
                : "No transactions yet"}
              {toReview(a.id) ? <Text style={{ color: t.accent, fontWeight: "700" }}> · {toReview(a.id)} to review</Text> : null}
              {linked.has(a.id) ? <Text style={{ color: t.good, fontWeight: "700" }}> · Linked</Text> : null}
            </Text>
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
      {cash.length ? (
        <View style={{ gap: space.xs }}>
          {head("Checking & savings", money(cashTotal), toggle)}
          <Card style={{ paddingVertical: space.xs }}>
            <DragList
              count={cash.length}
              keyOf={(n) => cash[n]!.id}
              nameOf={(n) => cash[n]!.name}
              grips={grips}
              onMove={(from, to) => update((p) => { p.accounts = reorderAmong(p.accounts, (a) => a.type === "cash", from, to); })}
              renderItem={(n, grip) => row(cash[n]!, n, grip, cash.length > 1)}
            />
          </Card>
        </View>
      ) : null}

      {cards.length ? (
        <View style={{ gap: space.xs }}>
          {head("Credit cards", `${money(owed)} owed`, cash.length ? null : toggle)}
          <Card style={{ paddingVertical: space.xs }}>
            <DragList
              count={cards.length}
              keyOf={(n) => cards[n]!.id}
              nameOf={(n) => cards[n]!.name}
              grips={grips}
              onMove={(from, to) => update((p) => { p.debts = reorderAmong(p.debts, isCard, from, to); })}
              renderItem={(n, grip) => row(cards[n]!, n, grip, cards.length > 1)}
            />
          </Card>
        </View>
      ) : null}

      {!all.length ? (
        <Card>
          <Text style={[type.caption, { color: t.text3 }]}>Add a cash account or a credit card under Money → Accounts to track transactions.</Text>
        </Card>
      ) : (
        <Text style={[type.caption, { color: t.text3, paddingHorizontal: space.xs }]}>
          Tap an account for its transactions. {compact ? "Tap Reorder, then drag a grip to move one." : "Drag a grip to reorder."} To add one, link a bank or change its settings, go to{" "}
          <Text role="link" onPress={() => router.push("/money/accounts" as never)} style={{ color: t.accent, fontWeight: "700" }}>Money → Accounts ›</Text>
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
              style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36, flexShrink: 1, minWidth: 0 }}
            >
              <View style={{ transform: [{ rotate: showTracking ? "90deg" : "0deg" }] }}>
                <Icon name="chevron" size={14} color={t.text3} />
              </View>
              {/* short, so it fits on a phone with its ⓘ and total (the ⓘ says what's in it) */}
              <Text numberOfLines={1} style={[type.overline, { color: t.text3, flexShrink: 1 }]}>Tracking accounts</Text>
            </Pressable>
            <InfoTip text={TRACKING_TIP} label="tracking accounts" open={tip} onToggle={setTip} />
            <View style={{ flex: 1 }} />
            <Text style={[type.caption, { color: t.text3, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(tracking.reduce((s, a) => s + (+a.balance || 0), 0))}</Text>
          </View>
          {tip ? <InfoText text={TRACKING_TIP} /> : null}
          {showTracking ? (
            <Card style={{ paddingVertical: space.xs, gap: space.xs }}>
              <DragList
                count={tracking.length}
                keyOf={(n) => tracking[n]!.id}
                nameOf={(n) => tracking[n]!.name}
                grips={grips}
                onMove={(from, to) => update((p) => { p.accounts = reorderAmong(p.accounts, (a) => a.type !== "cash" && a.type !== "property", from, to); })}
                renderItem={(n, grip) => { const a = tracking[n]!; return (
                <View>
                  {n > 0 ? <Divider /> : null}
                  <View style={styles.row}>
                    {tracking.length > 1 ? grip : null}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={[type.body, { color: t.text }]}>{a.name}</Text>
                      <Text style={[type.body, { color: t.text2, fontVariant: ["tabular-nums"] }]}>{money(a.balance)}</Text>
                    </View>
                    <Button title="Withdraw" onPress={() => onTransfer(a.id)} style={{ minHeight: 34 }} />
                  </View>
                </View>
                ); }}
              />
            </Card>
          ) : null}
        </View>
      ) : null}

      {closedList.length ? (
        <View style={{ gap: space.xs }}>
          <Pressable
            role="button"
            aria-expanded={showClosed}
            accessibilityLabel={`Closed accounts, ${showClosed ? "hide" : "show"}`}
            onPress={() => setShowClosed((v) => !v)}
            style={[styles.head, { minHeight: 36 }]}
          >
            <View style={{ transform: [{ rotate: showClosed ? "90deg" : "0deg" }] }}>
              <Icon name="chevron" size={14} color={t.text3} />
            </View>
            <Text style={[type.overline, { color: t.text3, flex: 1 }]}>Closed ({closedList.length})</Text>
          </Pressable>
          {showClosed ? (
            <Card style={{ paddingVertical: space.xs }}>
              {closedList.map((a, n) => <View key={a.id}>{row(a, n, null, false)}</View>)}
            </Card>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs, paddingVertical: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm },
  link: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 40 },
});
