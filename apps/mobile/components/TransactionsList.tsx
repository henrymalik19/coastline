/**
 * Every transaction in one place (Budget → Transactions): all your budget accounts (checking, savings,
 * cards) for the budget's month, with search and an account filter. Tap one to change it. Each
 * account's register (reconcile) is a tap away.
 */
import { isStartTxn, registerBalance, startTxnId, type Txn } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, NumberInput, Select, TextField } from "./form";
import { Icon } from "./Icon";
import { TxnForm } from "./TxnForm";
import { Card, Divider } from "./ui";
import { categoryText, isoDay, useCategories, needsCategory } from "../lib/categories";
import { money } from "../lib/format";
import { useLayout } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { budgetAccounts } from "../lib/register";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { ClearedDot } from "./ClearedDot";
import { sticky } from "../lib/sticky";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymText = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dayHead = (d: string) => {
  const dt = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return `${DOW[dt.getDay()]}, ${MON[dt.getMonth()]} ${dt.getDate()}${d.slice(0, 4) === String(new Date().getFullYear()) ? "" : `, ${d.slice(0, 4)}`}`;
};

/** `month` is "YYYY-MM" (the budget's month); `account` starts the list on one account. */
export function TransactionsList({ month, account, onlyNeedsCategory, stickyTop = 0 }: { month: string; account?: string; /** Open showing only the ones that need a category. */ onlyNeedsCategory?: boolean; /** Where the filters stop, under the Budget's toolbar. */ stickyTop?: number }) {
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
  const [needsCat, setNeedsCat] = useState(!!onlyNeedsCategory);
  const [editing, setEditing] = useState<Txn | "new" | null>(null);
  // the filters' height, so each day's heading sticks just under them
  const [filtersH, setFiltersH] = useState(96);
  const [reconciling, setReconciling] = useState(false);
  // opened on one account (from Accounts, or a link): start at the top, not where Accounts was scrolled
  const topRef = useRef<unknown>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || !account) return;
    let el = topRef.current as unknown as HTMLElement | null;
    while (el && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    el?.scrollTo({ top: 0 });
  }, [account]);
  const [bankSays, setBankSays] = useState(0);

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? state.accounts.find((a) => a.id === id)?.name ?? state.debts.find((d) => d.id === id)?.name ?? "Account";
  const uncategorized = (x: Txn) => needsCategory(x);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns
      .filter((x) => !x.deleted)
      .filter((x) => acct === "all" || x.accountId === acct || x.transferAccountId === acct)
      // the ones that need a category: from every month (the count beside it is all of them)
      .filter((x) => allMonths || needsCat || x.date.slice(0, 7) === month)
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

  // one account picked: what it holds (or owes), what has cleared, and reconcile ("does your bank say $X?")
  const hasReg = !!picked && txns.some((x) => !x.deleted && x.id === startTxnId(picked.id));
  const working = picked ? (hasReg ? registerBalance(0, txns, picked.id) : picked.balance) : 0;
  const cleared = picked ? (hasReg ? registerBalance(0, txns, picked.id, true) : picked.balance) : 0;
  const card = picked?.kind === "card";
  const show = (v: number) => (card ? `${money(-v)} owed` : money(v));
  const bankTarget = card ? -bankSays : bankSays;
  const reconcile = () => {
    if (!picked) return;
    const diff = Math.round((bankTarget - cleared) * 100) / 100;
    if (Math.abs(diff) > 0.004) {
      saveTxn({ id: newId(), accountId: picked.id, date: isoDay(start), amount: diff, payee: "Reconciliation adjustment", categoryId: "ready", cleared: "reconciled", source: "manual" }, isoDay(start));
    }
    // everything cleared is now reconciled
    for (const x of useStore.getState().txns.filter((y) => y.accountId === picked.id && !y.deleted && y.cleared === "cleared")) saveTxn({ ...x, cleared: "reconciled" }, isoDay(start));
    setReconciling(false);
  };
  const accountCard = picked ? (
    <Card style={{ gap: space.sm }}>
      <View style={[styles.row, { gap: space.md, justifyContent: "space-between" }]}>
        <View style={{ flexShrink: 1 }}>
          <Text style={[type.label, { color: t.text3 }]}>{picked.name} · {card ? "you owe" : "balance"}</Text>
          <Text style={[type.title, { color: working < 0 && !card ? t.bad : t.text, fontVariant: ["tabular-nums"] }]}>{card ? money(-working) : money(working)}</Text>
          <Text style={[type.caption, { color: t.text3 }]}>Cleared {show(cleared)}</Text>
        </View>
        <Button title="Reconcile" icon="check" onPress={() => { setBankSays(Math.round((card ? -cleared : cleared) * 100) / 100); setReconciling((v) => !v); }} style={{ minHeight: 36 }} />
      </View>
      {reconciling ? (
        <View style={{ gap: space.sm }}>
          <Divider />
          <Text style={[type.body, { color: t.text }]}>What does your bank say {card ? "you owe" : "the balance is"}, counting only what has cleared?</Text>
          <View style={[styles.row, { gap: space.sm }]}>
            <NumberInput kind="money" label="Bank balance" value={bankSays} width={160} onChange={setBankSays} />
            <Button title="Reconcile" tone="primary" onPress={reconcile} style={{ minHeight: 40 }} />
            <Button title="Cancel" tone="ghost" onPress={() => setReconciling(false)} style={{ minHeight: 40 }} />
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>
            {Math.abs(bankTarget - cleared) < 0.005
              ? "It matches. Your cleared transactions get locked as reconciled."
              : `It's ${money(Math.abs(bankTarget - cleared))} ${bankTarget > cleared ? "more" : "less"} than your cleared balance. Reconciling adds an adjustment to Unassigned. Check for a missing transaction first.`}
          </Text>
        </View>
      ) : null}
    </Card>
  ) : null;

  return (
    <>
      <View ref={topRef as never} onLayout={(e) => setFiltersH(Math.round(e.nativeEvent.layout.height))} style={[{ gap: space.sm, paddingVertical: space.xs, marginVertical: -space.xs }, sticky(stickyTop, t.bg)]}>
      <View style={[styles.row, { gap: space.sm }]}>
        <Pressable role="checkbox" aria-checked={allMonths || needsCat} disabled={needsCat} onPress={() => setAllMonths((v) => !v)} hitSlop={6} style={[styles.chip, { borderColor: allMonths || needsCat ? t.accent : t.border, backgroundColor: allMonths || needsCat ? t.accentSoft : t.surface }]}>
          <Text style={[type.caption, { color: allMonths || needsCat ? t.accent : t.text2, fontWeight: "700" }]}>All months</Text>
        </Pressable>
        {missing ? (
          <Pressable role="checkbox" aria-checked={needsCat} onPress={() => setNeedsCat((v) => !v)} hitSlop={6} style={[styles.chip, { borderColor: needsCat ? t.warn : t.border, backgroundColor: needsCat ? t.warnSoft : t.surface }]}>
            <Text style={[type.caption, { color: needsCat ? t.text : t.warn, fontWeight: "700" }]}>Needs a category ({missing})</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.row, { gap: space.sm }]}>
        <View style={compact ? { flex: 1, minWidth: 0 } : { width: 240 }}>
          <Select
            label="Account"
            value={acct}
            onChange={setAcct}
            options={[{ value: "all", label: `All accounts (${accounts.length})` }, ...accounts.map((a) => ({ value: a.id, label: a.name, hint: a.kind === "card" ? "Credit card" : "Cash account" }))]}
          />
        </View>
        <View style={{ flex: 1, minWidth: compact ? 0 : 200 }}>
          <TextField label="Search transactions" placeholder={compact ? "Search" : "Search payee, category, amount"} value={q} onChange={setQ} />
        </View>
      </View>
      </View>

      {accountCard}
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
      </View>

      {days.length ? (
        <Card padded={false}>
          {days.map((g, gi) => (
            <View key={g.date}>
              <View style={[styles.dayHead, { backgroundColor: t.surface2, borderTopWidth: gi ? StyleSheet.hairlineWidth : 0, borderTopColor: t.border }, sticky(stickyTop + filtersH, t.surface2), gi === 0 ? { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg } : null]}>
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
                    <ClearedDot status={x.cleared} onToggle={() => saveTxn({ ...x, cleared: x.cleared === "cleared" ? "uncleared" : "cleared" }, isoDay(start))} />
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
