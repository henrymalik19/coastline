/**
 * Every transaction in one place (Budget → Transactions): all your budget accounts (checking, savings,
 * cards) for the budget's month, with search and an account filter. Tap one to change it. Each
 * account's register (reconcile) is a tap away.
 */
import { addMonths, isHistoryTxn, isStartTxn, isUpcoming, registerBalance, startTxnId, type Txn } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, DateField, InfoText, InfoTip, NumberInput, Select, TextField } from "./form";
import { Icon } from "./Icon";
import { TxnForm } from "./TxnForm";
import { Card, Divider } from "./ui";
import { categoryText, isoDay, useCategories, needsCategory, needsCategorySince } from "../lib/categories";
import { closedName, OUTSIDE, outsideName } from "../lib/outside";
import { money } from "../lib/format";
import { useLayout } from "../lib/layout";
import { usePlan } from "../lib/plan";
import { budgetAccounts } from "../lib/register";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { ClearedDot } from "./ClearedDot";
import { stackHeight, sticky } from "../lib/sticky";

/** The account filter's "All closed accounts". */
const CLOSED = "closed:*";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymText = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dayHead = (d: string) => {
  const dt = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return `${DOW[dt.getDay()]}, ${MON[dt.getMonth()]} ${dt.getDate()}${d.slice(0, 4) === String(new Date().getFullYear()) ? "" : `, ${d.slice(0, 4)}`}`;
};

/** `month` is "YYYY-MM" (the budget's month); `account` starts the list on one account. */
export function TransactionsList({
  month: budgetMonth, account, onlyNeedsCategory, onlyReview, stickyTop = 0, onAccountChange,
}: {
  /** The month it opens on (the Budget's); its own ‹ › step from there without changing the Budget's. */
  month: string;
  account?: string;
  /** Open showing only the ones that need a category. */
  onlyNeedsCategory?: boolean;
  /** Open showing only the ones held for review. */
  onlyReview?: boolean;
  /** Where the filters stop, under the Budget's toolbar. */
  stickyTop?: number;
  /** The account picked ("all" for every account), so Add a transaction can start in it. */
  onAccountChange?: (id: string) => void;
}) {
  const t = useTheme();
  const router = useRouter();
  const { contentWidth } = useLayout();
  const compact = contentWidth < 600;
  const { state, start } = usePlan();
  const txns = useStore((s) => s.txns);
  const saveTxn = useStore((s) => s.saveTxn);
  const cats = useCategories();
  const accounts = budgetAccounts(state);
  // the month shown: starts as the Budget's; ‹ › go to any month, old history included
  const [month, setMonth] = useState(budgetMonth);
  useEffect(() => setMonth(budgetMonth), [budgetMonth]);
  const [acct, setAcct] = useState(account && budgetAccounts(state).some((a) => a.id === account) ? account : "all");
  // tell the Budget screen, so its Add a transaction starts in this account
  useEffect(() => { onAccountChange?.(acct); }, [acct]); // eslint-disable-line react-hooks/exhaustive-deps
  // which dates: the month picked above, every date, or a range you pick
  const [range, setRange] = useState<"month" | "all" | "custom">("month");
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [to, setTo] = useState<string | undefined>(undefined);
  const allMonths = range === "all";
  const inRange = (d: string) => range === "all" || (range === "month" ? d.slice(0, 7) === month : (!from || d >= from) && (!to || d <= to));
  const [q, setQ] = useState("");
  // one category (and its sub categories), or all of them
  const [catF, setCatF] = useState("all");
  // a category or a search looks at every date (an old payee, a category used years ago); the date
  // picker shows it, and you can narrow it back down
  const pickCategory = (v: string) => {
    setCatF(v);
    if (v !== "all" && range === "month") setRange("all");
  };
  const search = (v: string) => {
    setQ(v);
    if (v.trim() && !q.trim() && range === "month") setRange("all");
  };
  const catKeys = useMemo(() => (catF === "all" ? null : new Set([catF, ...cats.filter((c) => c.parent === catF).map((c) => c.key)])), [catF, cats]);
  const catOptions = useMemo(() => {
    const name = (k: string) => cats.find((c) => c.key === k)?.label ?? "Category";
    const shown = cats.filter((c) => !c.hidden);
    return [
      { value: "all", label: "All categories" },
      // each category, then its sub categories (picking a category takes its sub categories too)
      ...shown.filter((c) => !c.parent).flatMap((c) => [
        { value: c.key, label: c.label, hint: c.group, section: "Categories" },
        ...shown.filter((s) => s.parent === c.key).map((s) => ({ value: s.key, label: `${c.label} › ${s.label}`, hint: c.group, section: "Categories" })),
      ]),
      ...cats.filter((c) => c.hidden).map((c) => ({ value: c.key, label: c.parent ? `${name(c.parent)} › ${c.label}` : c.label, section: "Archived" })),
    ];
  }, [cats]);
  const [needsCat, setNeedsCat] = useState(!!onlyNeedsCategory);
  // held for review (new from your bank, or not approved in YNAB yet): listed apart, counted once you accept them
  const [reviewOnly, setReviewOnly] = useState(!!onlyReview);
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

  // history from closed accounts (left out of an import): each one's name, with how many transactions
  const closedAccts = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of txns) if (!x.deleted && isHistoryTxn(x)) m.set(x.accountId, (m.get(x.accountId) ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [txns]);
  const closedSet = useMemo(() => new Set(closedAccts.map(([id]) => id)), [closedAccts]);
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? state.accounts.find((a) => a.id === id)?.name ?? state.debts.find((d) => d.id === id)?.name ?? (closedSet.has(id) ? closedName(id) : outsideName(id)) ?? "Account";
  // only this month's and last month's need a category; older ones are history
  const since = needsCategorySince(start);
  /** Under a transfer's from → to: what it's for (a card payment, from Unassigned…), and its memo. */
  const transferNote = (x: Txn) => {
    // an old one from a closed account: the category it was filed under (TCG Bonus), so it shows what it was
    const what = (isHistoryTxn(x) && x.categoryId ? cats.find((c) => c.key === x.categoryId)?.label : undefined) ?? categoryText(cats, x, nameOf, since).match(/\(([^)]*)\)$/)?.[1];
    return [what ?? "Transfer", x.payee && !/^transfer/i.test(x.payee) ? x.payee : "", x.memo ?? ""].filter(Boolean).join(" · ");
  };
  const uncategorized = (x: Txn) => needsCategory(x, since);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns
      .filter((x) => !x.deleted)
      .filter((x) => acct === "all" || (acct === CLOSED ? isHistoryTxn(x) : x.accountId === acct || x.transferAccountId === acct))
      // the ones that need a category: from every month (the count beside it is all of them)
      .filter((x) => needsCat || reviewOnly || inRange(x.date))
      .filter((x) => !needsCat || uncategorized(x))
      .filter((x) => !reviewOnly || x.review)
      .filter((x) => !catKeys || (!!x.categoryId && catKeys.has(x.categoryId)) || !!x.splits?.some((s) => !!s.categoryId && catKeys.has(s.categoryId)))
      .filter((x) => {
        if (!needle) return true;
        const hay = `${x.payee ?? ""} ${x.memo ?? ""} ${categoryText(cats, x, nameOf)} ${nameOf(x.accountId)} ${Math.abs(x.amount).toFixed(2)}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => (a.date === b.date ? b.updatedAt - a.updatedAt : b.date.localeCompare(a.date)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, acct, month, range, from, to, q, needsCat, reviewOnly, cats, catKeys]);

  // dated after today: upcoming, shown greyed at the top and not counted until their day
  const today = isoDay(start);
  // a starting balance isn't money in or spending: it's what the account held when you began
  const happened = list.filter((x) => !isUpcoming(x, today) && !x.review && !isStartTxn(x));
  const inTotal = happened.reduce((a, x) => a + (x.amount > 0 && !x.transferAccountId ? x.amount : 0), 0);
  const outTotal = happened.reduce((a, x) => a + (x.amount < 0 && !x.transferAccountId ? -x.amount : 0), 0);
  // the count follows the account picker, like everything else here; ones in other accounts get a link instead
  const inView = (x: Txn) => acct === "all" || x.accountId === acct || x.transferAccountId === acct;
  const missingAll = txns.filter((x) => !x.deleted && uncategorized(x));
  const missing = missingAll.filter(inView).length;
  const missingElsewhere = missingAll.length - missing;
  const toReview = txns.filter((x) => !x.deleted && x.review && inView(x));
  const accept = (x: Txn) => { const { review: _r, ...rest } = x; saveTxn(rest, isoDay(start)); };
  const [reviewTip, setReviewTip] = useState(false);
  const reviewInfo = `${toReview.every((x) => x.source === "plaid") ? "New from your bank." : toReview.some((x) => x.source === "plaid") ? "New from your bank, or not approved in YNAB yet." : "Not approved in YNAB yet."} They count in your balances and budget once you accept them. Tap one to change it first.`;

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

  // grouped by day. All accounts: a transfer between two of them shows once (from → to), on its outgoing side
  const listed = new Set(list.map((x) => x.id));
  const pairOf = new Map(txns.filter((x) => x.transferId).map((x) => [x.id, x.transferId!]));
  const shown = acct === "all" ? list.filter((x) => !(x.transferAccountId && x.amount > 0 && pairOf.get(x.id) && listed.has(pairOf.get(x.id)!))) : list;
  const days: { date: string; items: Txn[] }[] = [];
  for (const x of shown) {
    const last = days[days.length - 1];
    if (last && last.date === x.date) last.items.push(x);
    else days.push({ date: x.date, items: [x] });
  }
  const picked = accounts.find((a) => a.id === acct);

  // one account picked: what it holds (or owes), what has cleared, and reconcile ("does your bank say $X?")
  const hasReg = !!picked && txns.some((x) => !x.deleted && x.id === startTxnId(picked.id));
  const working = picked ? (hasReg ? registerBalance(0, txns, picked.id, false, today) : picked.balance) : 0;
  const cleared = picked ? (hasReg ? registerBalance(0, txns, picked.id, true, today) : picked.balance) : 0;
  const upcomingTotal = picked ? txns.filter((x) => !x.deleted && x.accountId === picked.id && isUpcoming(x, today)).reduce((a, x) => a + x.amount, 0) : 0;
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
          {Math.abs(upcomingTotal) > 0.005 ? (
            <Text style={[type.caption, { color: t.text3 }]}>
              {show(working + upcomingTotal)} after upcoming ({upcomingTotal > 0 ? "+" : "−"}{money(Math.abs(upcomingTotal))})
            </Text>
          ) : null}
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
      <View ref={topRef as never} onLayout={(e) => setFiltersH(stackHeight(e.nativeEvent.layout.height))} style={[{ gap: space.sm, paddingVertical: space.xs, marginVertical: -space.xs }, sticky(stickyTop, t.bg)]}>
      <View style={[styles.row, { gap: space.sm }]}>
        {needsCat || reviewOnly ? (
          <Text style={[type.caption, { color: t.text3, fontWeight: "700" }]}>All dates</Text>
        ) : (
          // the dates, like the Budget's month (‹ Nov 2026 ›), but the month opens a list: all dates, or a range.
          // Its own month: going back here doesn't move the Budget's
          <View style={[styles.row, { gap: space.md, flexWrap: "nowrap", width: "100%" }]}>
            <Pressable role="button" accessibilityLabel="Previous month" disabled={range !== "month"} onPress={() => setMonth(addMonths(month, -1))} hitSlop={8} style={[styles.navBtn, { borderColor: t.border, opacity: range === "month" ? 1 : 0 }]}>
              <Icon name="back" size={16} color={t.accent} />
            </Pressable>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Select
                label="Dates"
                value={range}
                options={[{ value: "month", label: ymText(month) }, { value: "all", label: "All dates" }, { value: "custom", label: "Pick dates…" }]}
                onChange={(v) => {
                  setRange(v as typeof range);
                  // a range starts as this month so far
                  if (v === "custom" && !from && !to) { setFrom(`${month}-01`); setTo(today); }
                }}
                trigger={(open) => (
                  <Pressable role="button" aria-haspopup="listbox" accessibilityLabel={`Dates: ${range === "month" ? ymText(month) : range === "all" ? "all dates" : "picked dates"}. Change`} onPress={open} hitSlop={6} style={styles.dateHead}>
                    <Text style={[type.heading, { color: t.text }]}>{range === "month" ? ymText(month) : range === "all" ? "All dates" : "Picked dates"}</Text>
                    <Icon name="down" size={16} color={t.accent} />
                  </Pressable>
                )}
              />
              {range === "month" && month === today.slice(0, 7) ? (
                <Text style={[type.overline, { color: t.accent }]}>This month</Text>
              ) : range === "month" ? (
                <Pressable role="button" onPress={() => setMonth(today.slice(0, 7))} hitSlop={6}>
                  <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Back to this month</Text>
                </Pressable>
              ) : (
                <Pressable role="button" onPress={() => setRange("month")} hitSlop={6}>
                  <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Back to one month</Text>
                </Pressable>
              )}
            </View>
            <Pressable role="button" accessibilityLabel="Next month" disabled={range !== "month"} onPress={() => setMonth(addMonths(month, 1))} hitSlop={8} style={[styles.navBtn, { borderColor: t.border, opacity: range === "month" ? 1 : 0 }]}>
              <Icon name="chevron" size={16} color={t.accent} />
            </Pressable>
          </View>
        )}
        {/* the two "waiting on you" chips stay together: one row, wrapping as a pair */}
        <View style={[styles.row, { gap: space.sm }]}>
        {toReview.length || reviewOnly ? (
          <Pressable role="checkbox" aria-checked={reviewOnly} onPress={() => { setReviewOnly((v) => !v); setNeedsCat(false); }} hitSlop={6} style={[styles.chip, { borderColor: t.accent, backgroundColor: reviewOnly ? t.accentSoft : t.surface }]}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>To review ({toReview.length})</Text>
          </Pressable>
        ) : null}
        {reviewOnly ? <InfoTip text={reviewInfo} label="To review" open={reviewTip} onToggle={setReviewTip} /> : null}
        {missing || needsCat ? (
          <Pressable role="checkbox" aria-checked={needsCat} onPress={() => { setNeedsCat((v) => !v); setReviewOnly(false); }} hitSlop={6} style={[styles.chip, { borderColor: needsCat ? t.warn : t.border, backgroundColor: needsCat ? t.warnSoft : t.surface }]}>
            <Text style={[type.caption, { color: needsCat ? t.text : t.warn, fontWeight: "700" }]}>Needs a category ({missing})</Text>
          </Pressable>
        ) : missingElsewhere ? (
          // none in this account, but some in others: one tap shows them all
          <Pressable role="link" onPress={() => { setAcct("all"); setNeedsCat(true); }} hitSlop={6}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{missingElsewhere} to categorize in other accounts</Text>
          </Pressable>
        ) : null}
        </View>
      </View>
      {range === "custom" && !needsCat ? (
        // two equal halves, edge to edge like the fields below
        <View style={[styles.row, { gap: space.sm }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <DateField label="From" value={from} onChange={setFrom} width="100%" />
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>to</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <DateField label="To" value={to} onChange={setTo} width="100%" />
          </View>
        </View>
      ) : null}
      {/* phones: the account and the category side by side, the search on its own line */}
      <View style={[styles.row, { gap: space.sm }, compact ? { flexDirection: "column", alignItems: "stretch" } : null]}>
        <View style={[styles.row, { gap: space.sm }, compact ? { width: "100%" } : null]}>
          <View style={compact ? { flex: 1, minWidth: 0 } : { width: 220 }}>
            <Select
              label="Account"
              value={acct}
              onChange={setAcct}
              options={[
                { value: "all", label: `All accounts (${accounts.length})` },
                ...accounts.map((a) => ({ value: a.id, label: a.name, hint: a.kind === "card" ? "Credit card" : "Cash account" })),
                // history from accounts you didn't bring in: all of them, or one
                ...(closedAccts.length
                  ? [
                      { value: CLOSED, label: `All closed accounts (${closedAccts.length})`, hint: "History only", section: "Closed accounts" },
                      ...closedAccts.map(([id, n]) => ({ value: id, label: id.slice(OUTSIDE.length), hint: `${n.toLocaleString()} transactions · history only`, section: "Closed accounts" })),
                    ]
                  : []),
              ]}
            />
          </View>
          <View style={compact ? { flex: 1, minWidth: 0 } : { width: 220 }}>
            <Select label="Category" value={catF} onChange={pickCategory} options={catOptions} />
          </View>
        </View>
        <View style={compact ? { width: "100%" } : { flex: 1, minWidth: 200 }}>
          <TextField label="Search transactions" placeholder={compact ? "Search" : "Search payee, category, amount"} value={q} onChange={search} />
        </View>
      </View>
      </View>

      {reviewOnly && reviewTip ? <InfoText text={reviewInfo} /> : null}
      {accountCard}
      <View style={[styles.summary, { backgroundColor: t.surface2 }]}>
        {[
          { k: "Money in", v: money(inTotal), c: t.good },
          { k: "Spent", v: money(outTotal), c: t.text },
          { k: "Transactions", v: String(shown.length), c: t.text },
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
                <Text style={[type.overline, { color: g.date > today ? t.accent : t.text3 }]}>
                  {dayHead(g.date)}{g.date > today ? " · Upcoming" : ""}
                </Text>
              </View>
              {g.items.map((x, i) => (
                // a faint tint on the ones waiting on you: held for review, or needing a category
                <View key={x.id} style={x.review ? { backgroundColor: t.accentSoft } : uncategorized(x) ? { backgroundColor: t.warnSoft } : null}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable
                    role="button"
                    accessibilityLabel={`${g.date > today ? "Upcoming: " : ""}${x.payee || "Transaction"} ${x.amount > 0 ? "plus" : "minus"} ${money(Math.abs(x.amount))}. Change`}
                    onPress={() => setEditing(x)}
                    style={({ pressed }) => [styles.txn, g.date > today ? { opacity: 0.6 } : null, pressed ? { backgroundColor: t.surface2 } : null]}
                  >
                    <ClearedDot status={x.cleared} history={isHistoryTxn(x)} onToggle={() => saveTxn({ ...x, cleared: x.cleared === "cleared" ? "uncleared" : "cleared" }, isoDay(start))} />
                    {x.transferAccountId ? (
                      // a transfer: from → to, with what it's for underneath
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={[styles.transferBadge, { backgroundColor: t.accentSoft }]}>
                            <Icon name="transfer" size={14} color={t.accent} />
                          </View>
                          <Text numberOfLines={2} style={[type.body, { color: t.text, flexShrink: 1 }]}>
                            {x.amount < 0 ? nameOf(x.accountId) : nameOf(x.transferAccountId)}
                            <Text style={{ color: t.text3 }}>{"  →  "}</Text>
                            {x.amount < 0 ? nameOf(x.transferAccountId) : nameOf(x.accountId)}
                          </Text>
                        </View>
                        <Text numberOfLines={1} style={[type.caption, { color: uncategorized(x) ? t.warn : t.text3 }]}>
                          {transferNote(x)}
                        </Text>
                      </View>
                    ) : (
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={[type.body, { color: t.text }]}>{x.payee || "No payee"}</Text>
                        <Text numberOfLines={1} style={[type.caption, { color: x.review ? t.accent : uncategorized(x) ? t.warn : t.text3 }]}>
                          {x.review ? `To review · ${x.categoryId || x.splits?.length ? categoryText(cats, x, nameOf, since) : "no category"}` : categoryText(cats, x, nameOf, since)}
                        </Text>
                      </View>
                    )}
                    <View style={{ alignItems: "flex-end", maxWidth: compact ? 120 : 180 }}>
                      <Text style={[type.body, { color: x.transferAccountId ? t.text2 : x.amount > 0 ? t.good : t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>
                        {acct === "all" && x.transferAccountId ? "" : x.amount > 0 ? "+" : "−"}{money(Math.abs(x.amount))}
                      </Text>
                      {/* all accounts: which account it's in, as a small tag under the amount */}
                      {acct === "all" && !x.transferAccountId ? (
                        <View style={[styles.acctTag, { backgroundColor: t.surface2 }]}>
                          <Text numberOfLines={1} style={[type.caption, { color: t.text2, fontWeight: "600" }]}>{nameOf(x.accountId)}</Text>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                  {x.review ? (
                    // held for review: accept it here (outside the row's own button)
                    <View style={styles.reviewBar}>
                      <Pressable role="button" accessibilityLabel={`Accept ${x.payee || "transaction"}`} onPress={() => accept(x)} hitSlop={6} style={[styles.acctTag, { backgroundColor: t.surface, borderWidth: 1, borderColor: t.accent, paddingHorizontal: 12, paddingVertical: 4 }]}>
                        <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Accept</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </Card>
      ) : (
        <Card style={{ gap: space.sm }}>
          <Text style={[type.body, { color: t.text2 }]}>
            {catF !== "all" && !q && !needsCat && !reviewOnly
              ? txns.some((x) => !x.deleted && (catKeys?.has(x.categoryId ?? "") || x.splits?.some((s) => catKeys?.has(s.categoryId ?? ""))))
                ? "Nothing in this category for these dates."
                : "No transactions in this category, ever. It may only have held money you set aside."
              : q || needsCat || reviewOnly ? "Nothing matches." : allMonths ? "No transactions yet." : range === "custom" ? "No transactions between those dates." : `No transactions in ${ymText(month)}.`}
          </Text>
          <Text style={[type.caption, { color: t.text3 }]}>Add what you spend and earn here. Each one comes out of (or goes into) a budget category.</Text>
        </Card>
      )}
      {txns.some((x) => !x.deleted && x.payee) ? (
        <Pressable role="link" onPress={() => router.push("/money/payees")} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" }}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Payees: rename or combine</Text>
          <Icon name="chevron" size={12} color={t.accent} />
        </Pressable>
      ) : null}
      {editing ? <TxnForm txn={editing === "new" ? undefined : editing} accountId={editing === "new" && picked ? picked.id : undefined} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  navBtn: { borderWidth: 1, borderRadius: 999, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  dateHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  summary: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: 10, paddingHorizontal: space.md, paddingVertical: 8 },
  dayHead: { paddingHorizontal: 16, paddingVertical: 6 },
  txn: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 16, paddingVertical: 12 },
  transferBadge: { width: 20, height: 20, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  reviewBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingBottom: 10, marginTop: -6 },
  acctTag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, marginTop: 2, maxWidth: "100%" },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});
