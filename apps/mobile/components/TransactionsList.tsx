/**
 * Every transaction in one place (Budget → Transactions): all your budget accounts (checking, savings,
 * cards) for the budget's month, with search and an account filter. Tap one to change it. Each
 * account's register (reconcile) is a tap away.
 */
import { isStartTxn, type Txn } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Select, TextField } from "./form";
import { Icon } from "./Icon";
import { TxnForm } from "./TxnForm";
import { Card, Divider } from "./ui";
import { categoryText, isoDay, useCategories } from "../lib/categories";
import { money } from "../lib/format";
import { useLayout } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { budgetAccounts } from "../lib/register";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymText = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dayHead = (d: string) => {
  const dt = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return `${DOW[dt.getDay()]}, ${MON[dt.getMonth()]} ${dt.getDate()}${d.slice(0, 4) === String(new Date().getFullYear()) ? "" : `, ${d.slice(0, 4)}`}`;
};

/** `month` is "YYYY-MM" (the budget's month); `account` starts the list on one account. */
export function TransactionsList({ month, account }: { month: string; account?: string }) {
  const t = useTheme();
  const router = useRouter();
  const { contentWidth } = useLayout();
  const compact = contentWidth < 600;
  const { state, start } = usePlan();
  const txns = useStore((s) => s.txns);
  const saveTxn = useStore((s) => s.saveTxn);
  const cats = useCategories();
  const accounts = budgetAccounts(state);
  const [acct, setAcct] = useState(account && budgetAccounts(state).some((a) => a.id === account) ? account : "all");
  const [allMonths, setAllMonths] = useState(false);
  const [q, setQ] = useState("");
  const [needsCat, setNeedsCat] = useState(false);
  const [editing, setEditing] = useState<Txn | "new" | null>(null);

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? state.accounts.find((a) => a.id === id)?.name ?? state.debts.find((d) => d.id === id)?.name ?? "Account";
  const uncategorized = (x: Txn) => !x.categoryId && !x.transferAccountId && !x.splits?.length && !isStartTxn(x);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns
      .filter((x) => !x.deleted)
      .filter((x) => acct === "all" || x.accountId === acct || x.transferAccountId === acct)
      .filter((x) => allMonths || x.date.slice(0, 7) === month)
      .filter((x) => !needsCat || uncategorized(x))
      .filter((x) => {
        if (!needle) return true;
        const hay = `${x.payee ?? ""} ${x.memo ?? ""} ${categoryText(cats, x, nameOf)} ${nameOf(x.accountId)} ${Math.abs(x.amount).toFixed(2)}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => (a.date === b.date ? b.updatedAt - a.updatedAt : b.date.localeCompare(a.date)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, acct, month, allMonths, q, needsCat, cats]);

  const inTotal = list.reduce((a, x) => a + (x.amount > 0 && !x.transferAccountId ? x.amount : 0), 0);
  const outTotal = list.reduce((a, x) => a + (x.amount < 0 && !x.transferAccountId ? -x.amount : 0), 0);
  const missing = txns.filter((x) => !x.deleted && uncategorized(x)).length;

  const addButton = state.budgetPlan && accounts.length ? (
    <Button title={compact ? "Add" : "Add a transaction"} icon="plus" tone="primary" onPress={() => setEditing("new")} style={{ minHeight: 36 }} />
  ) : null;

  if (!state.budgetPlan || !accounts.length) {
    return (
        <Card style={{ gap: space.md }}>
          <Text style={[type.body, { color: t.text2 }]}>
            {!state.budgetPlan
              ? "Transactions belong to your monthly budget. Start it on the Budget tab, then add what you spend and earn here."
              : "Add a cash account (checking or savings) or a credit card under Your money to start tracking transactions."}
          </Text>
          <Button title={!state.budgetPlan ? "Go to Budget" : "Add an account"} tone="primary" onPress={() => router.push(!state.budgetPlan ? "/budget" : "/money/accounts")} style={{ alignSelf: "flex-start" }} />
        </Card>
    );
  }

  // grouped by day
  const days: { date: string; items: Txn[] }[] = [];
  for (const x of list) {
    const last = days[days.length - 1];
    if (last && last.date === x.date) last.items.push(x);
    else days.push({ date: x.date, items: [x] });
  }
  const picked = accounts.find((a) => a.id === acct);

  return (
    <>
      <View style={[styles.row, { gap: space.sm }]}>
        {addButton}
        <Pressable role="checkbox" aria-checked={allMonths} onPress={() => setAllMonths((v) => !v)} hitSlop={6} style={[styles.chip, { borderColor: allMonths ? t.accent : t.border, backgroundColor: allMonths ? t.accentSoft : t.surface }]}>
          <Text style={[type.caption, { color: allMonths ? t.accent : t.text2, fontWeight: "700" }]}>All months</Text>
        </Pressable>
        {missing ? (
          <Pressable role="checkbox" aria-checked={needsCat} onPress={() => setNeedsCat((v) => !v)} hitSlop={6} style={[styles.chip, { borderColor: needsCat ? t.warn : t.border, backgroundColor: needsCat ? t.warnSoft : t.surface }]}>
            <Text style={[type.caption, { color: needsCat ? t.text : t.warn, fontWeight: "700" }]}>Needs a category ({missing})</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.row, { gap: space.sm }]}>
        <View style={{ width: compact ? "100%" : 260 }}>
          <Select
            label="Account"
            value={acct}
            onChange={setAcct}
            options={[{ value: "all", label: `All accounts (${accounts.length})` }, ...accounts.map((a) => ({ value: a.id, label: a.name, hint: a.kind === "card" ? "Credit card" : "Cash account" }))]}
          />
        </View>
        <View style={{ flex: 1, minWidth: compact ? "100%" : 200 }}>
          <TextField label="Search transactions" placeholder="Search payee, category, amount" value={q} onChange={setQ} />
        </View>
      </View>

      <View style={[styles.summary, { backgroundColor: t.surface2 }]}>
        {[
          { k: "Money in", v: money(inTotal), c: t.good },
          { k: "Spent", v: money(outTotal), c: t.text },
          { k: "Transactions", v: String(list.length), c: t.text },
        ].map((x) => (
          <View key={x.k} style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[type.caption, { color: t.text3 }]}>{x.k}</Text>
            <Text numberOfLines={1} style={[type.label, { color: x.c, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{x.v}</Text>
          </View>
        ))}
        {picked ? (
          <Pressable role="link" onPress={() => router.push(`/money/register?account=${picked.id}`)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Reconcile</Text>
            <Icon name="chevron" size={12} color={t.accent} />
          </Pressable>
        ) : null}
      </View>

      {days.length ? (
        <Card padded={false}>
          {days.map((g, gi) => (
            <View key={g.date}>
              <View style={[styles.dayHead, { backgroundColor: t.surface2, borderTopWidth: gi ? StyleSheet.hairlineWidth : 0, borderTopColor: t.border }]}>
                <Text style={[type.overline, { color: t.text3 }]}>{dayHead(g.date)}</Text>
              </View>
              {g.items.map((x, i) => (
                <View key={x.id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable
                    role="button"
                    accessibilityLabel={`${x.payee || "Transaction"} ${x.amount > 0 ? "plus" : "minus"} ${money(Math.abs(x.amount))}. Change`}
                    onPress={() => setEditing(x)}
                    style={({ pressed }) => [styles.txn, pressed ? { backgroundColor: t.surface2 } : null]}
                  >
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
                      <Text numberOfLines={1} style={[type.body, { color: t.text }]}>{x.payee || (x.transferAccountId ? "Transfer" : "No payee")}</Text>
                      <Text numberOfLines={1} style={[type.caption, { color: uncategorized(x) ? t.warn : t.text3 }]}>
                        {categoryText(cats, x, nameOf)}{acct === "all" ? ` · ${nameOf(x.accountId)}` : ""}
                      </Text>
                    </View>
                    <Text style={[type.body, { color: x.amount > 0 ? t.good : t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>
                      {x.amount > 0 ? "+" : "−"}{money(Math.abs(x.amount))}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ))}
        </Card>
      ) : (
        <Card style={{ gap: space.sm }}>
          <Text style={[type.body, { color: t.text2 }]}>
            {q || needsCat ? "Nothing matches." : allMonths ? "No transactions yet." : `No transactions in ${ymText(month)}.`}
          </Text>
          <Text style={[type.caption, { color: t.text3 }]}>Add what you spend and earn here. Each one comes out of (or goes into) a budget category.</Text>
        </Card>
      )}
      {editing ? <TxnForm txn={editing === "new" ? undefined : editing} accountId={editing === "new" && picked ? picked.id : undefined} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  summary: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: 10, paddingHorizontal: space.md, paddingVertical: 8 },
  dayHead: { paddingHorizontal: 16, paddingVertical: 6 },
  txn: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 16, paddingVertical: 12 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});
