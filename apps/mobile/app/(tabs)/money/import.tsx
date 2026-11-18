/**
 * Import from YNAB: pick its export, then choose which months to bring in, what each of its
 * accounts is here (match, add or skip), and which categories you'd still pay after retiring and
 * which are essential. Nothing changes until you press Import.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { isAppPath } from "../../../lib/nav";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, InfoText, InfoTip, InlineMoney, InlineSwitch, MonthField, Segmented, Select, TextField, ToggleRow } from "../../../components/form";
import { fullName, splitCompanies } from "../../../lib/company";
import { Icon, type IconName } from "../../../components/Icon";
import { Card, Divider, Screen } from "../../../components/ui";
import { money } from "../../../lib/format";
import { effectivePlan, usePlan } from "../../../lib/plan";
import { useLimits } from "../../../lib/limits";
import { applyRegisterBalances, isCard, readyToAssignFor } from "../../../lib/register";
import { monthKey, useStore } from "../../../lib/store";
import { space, type, useTheme } from "../../../lib/theme";
import { isoDay } from "../../../lib/categories";
import { readYnabFiles } from "../../../lib/ynabFiles";
import { balanceConflicts, buildImport, categoryKey, exportMonths, groupKey, recentMonths, suggestCategory, suggestChoice, budgetTxnsThisMonth, ynabAccounts, ynabCategories, ynabReadyToAssign, type ImportResult, type AccountChoice, type CategoryChoice, type YnabAccount, type YnabCategory, type YnabData } from "../../../lib/ynab";
import { sticky, stickyBottom } from "../../../lib/sticky";
import { useLayout } from "../../../lib/layout";
import { groupOrder } from "../../../lib/budgetOrder";
import { ImportUndoCard, useImported } from "../../../components/ImportUndo";
import { YnabUpdateCard } from "../../../components/YnabUpdate";
import { DragList, useDragZone } from "../../../components/DragList";
import { ReorderToggle } from "../../../components/ReorderToggle";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymText = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** A YNAB account that's closed or empty: no balance and nothing in it since `since`. */
const quietAccount = (d: YnabData, name: string, balance: number, since: string | null) =>
  Math.abs(balance) < 0.005 && !d.txns.some((t) => t.account === name && (!since || t.date.slice(0, 7) >= since));
/** A YNAB category you haven't used lately: nothing assigned and nothing spent since `since`. */
const unusedCategory = (d: YnabData, c: { group: string; name: string; average: number }, since: string | null) => {
  const same = (g: string, n: string) => categoryKey(g, n) === categoryKey(c.group, c.name);
  const recent = (m: string) => !since || m >= since;
  return c.average === 0 &&
    !d.assigned.some((a) => same(a.group, a.category) && recent(a.month) && a.assigned > 0) &&
    !d.txns.some((t) => recent(t.date.slice(0, 7)) && (same(t.group, t.category) || (t.splits ?? []).some((x) => same(x.group, x.category))));
};
/** Left out, or kept as a hidden category: either way it has no monthly amount or retirement switches. */
const offBudget = (c?: CategoryChoice) => c?.action === "skip" || c?.action === "hidden";
const KIND_LABEL = { cash: "Checking or savings", card: "Credit card", invest: "Investment (tracking)", loan: "Loan (tracking)" } as const;
const ACCT_INFO =
  "Same as one you already have (its balance and transactions join it), a new account, or left out. Closed and empty accounts start left out.";
const CAT_INFO =
  "Becomes: what it turns into here: a new category, one of yours (their money and transactions join), or nothing. Groups: pick which of your groups each YNAB group lands in, or move just one category to another group (its group link, or drag it). Turn off After retiring for what you won't pay then, and Essential for what you'd cut in an emergency.";
const KIND_ORDER =["cash", "card", "invest", "loan"] as const;
const KIND_SECTION = { cash: "Checking & savings", card: "Credit cards", invest: "Investments", loan: "Loans" } as const;

/** `setup`: opened from setup (before there's a budget); it goes back to setup when done. */
export default function ImportYnab({ setup }: { setup?: boolean } = {}) {
  const t = useTheme();
  const router = useRouter();
  const { back: backTo } = useLocalSearchParams<{ back?: string }>();
  const { state, start } = usePlan();
  const saved = useStore((s) => s.plan);
  const importBudget = useStore((s) => s.importBudget);
  // one import per budget (on any device): after it, undo it or start over
  const imported = useImported();
  const [undone, setUndone] = useState(false);
  const backToSetup = () => router.replace(`/onboarding?step=${useStore.getState().importedAt ? "you" : "start"}`);
  const existing = useStore((s) => s.txns);
  const thisMonth = monthKey(start);
  const [data, setData] = useState<YnabData | null>(null);
  // scheduled transactions dated after today, left out of this import
  const [future, setFuture] = useState(0);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [doneNeeds, setDoneNeeds] = useState(0);
  // the first month to bring in ("all" = everything); default: the last 3
  const [range, setRange] = useState<string>("");
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [choices, setChoices] = useState<Record<string, AccountChoice>>({});
  // the company and name each added account gets here: "Chase - Sapphire" splits when other names share "Chase -"
  const [names, setNames] = useState<Record<string, { company?: string; name: string }>>({});
  const setName = (account: string, patch: { company?: string; name?: string }) => setNames((s) => ({ ...s, [account]: { ...(s[account] ?? { name: account }), ...patch } }));
  const [catOpts, setCatOpts] = useState<Record<string, { inRetirement: boolean; essential: boolean }>>({});
  const [removeEmpty, setRemoveEmpty] = useState(true);
  const [catMap, setCatMap] = useState<Record<string, CategoryChoice>>({});
  const [keepBoth, setKeepBoth] = useState<string[]>([]);
  // which of your groups each YNAB group's categories land in
  const [groupMap, setGroupMap] = useState<Record<string, string>>({});
  // one category into a different group than the rest of its YNAB group
  const [catGroup, setCatGroup] = useState<Record<string, string>>({});
  // drag a category onto another group's card: it lands in that card's group
  const cardRowsRef = useRef<Record<string, YnabCategory[]>>({});
  const cardTargetRef = useRef<(g: string) => string>((g) => g);
  const zone = useDragZone((fromCard, from, toCard) => {
    const c = cardRowsRef.current[fromCard]?.[from];
    if (!c) return;
    const k = categoryKey(c.group, c.name);
    const to = cardTargetRef.current(toCard);
    setCatGroup(({ [k]: _, ...m }) => (to === cardTargetRef.current(c.group) ? m : { ...m, [k]: to }));
  });
  const [tab, setTab] = useState<"accounts" | "categories" | "matches">("accounts");
  const [showQuiet, setShowQuiet] = useState(false);
  // the accounts tucked under "leaving out", fixed while you're on the Accounts list
  const [tucked, setTucked] = useState<Set<string> | null>(null);
  const [showUnused, setShowUnused] = useState(false);
  const [catTip, setCatTip] = useState(false);
  const [acctTip, setAcctTip] = useState(false);
  // the confirmation shows on the page (a browser pop-up can be blocked, as in an embedded browser)
  const [confirming, setConfirming] = useState(false);
  // the pinned tabs' height, so the categories' column labels stick just under them
  const [tabsH, setTabsH] = useState(44);
  const { contentWidth } = useLayout();
  const wide = Platform.OS === "web" && contentWidth >= 960;
  // phones: grips only while reordering
  const [reorder, setReorder] = useState(false);

  const pick = () => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,.csv";
    input.multiple = true;
    input.onchange = async () => {
      setError("");
      setDone("");
      try {
        const d = await readYnabFiles(input.files!);
        if (!d.txns.length) throw new Error("No transactions in that file.");
        // YNAB's scheduled ones (dated after today) come in as upcoming: they count on their day
        setFuture(d.txns.filter((x) => x.date > isoDay(start)).length);
        setData(d);
        running.current = false;
        setFileName([...input.files!].find((x) => /\.zip$/i.test(x.name))?.name ?? input.files![0]?.name ?? "");
        const since = recentMonths(thisMonth, 2)[0]!;
        // closed or empty accounts start left out; the open ones match an account here with the same name (each only once)
        const taken = new Set<string>();
        setNames(splitCompanies(ynabAccounts(d, isoDay(start)).map((a) => a.name)));
        setChoices(Object.fromEntries(ynabAccounts(d, isoDay(start)).map((a) => {
          if (quietAccount(d, a.name, a.balance, since)) return [a.name, { action: "skip" }];
          const sug = suggestChoice(state, a, taken);
          if (sug.action === "match") taken.add(sug.id);
          return [a.name, sug];
        })));
        setCatMap(Object.fromEntries(ynabCategories(d, recentMonths(thisMonth)).map((c) => {
          const sug = suggestCategory(state, c);
          return [categoryKey(c.group, c.name), sug.action === "new" && unusedCategory(d, c, since) ? { action: "hidden" } : sug];
        })));
        setTab("accounts");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    };
    input.click();
  };

  const accounts = useMemo(() => (data ? ynabAccounts(data, isoDay(start)) : []), [data, start]);
  const categories = useMemo(() => (data ? ynabCategories(data, recentMonths(thisMonth)) : []), [data, thisMonth]);
  const months = useMemo(() => (data ? exportMonths(data, thisMonth) : []), [data, thisMonth]);
  // default: the last 3 months, or all the export has if that is less
  const startPick = range || (months.includes(recentMonths(thisMonth, 2)[0]!) ? recentMonths(thisMonth, 2)[0]! : "all");
  const from = startPick === "all" ? null : startPick;
  const oldest = months[months.length - 1];
  const startMonth = from ?? oldest ?? thisMonth;
  const monthCount = months.indexOf(startMonth) + 1;
  const opts = (k: string) => catOpts[k] ?? { inRetirement: true, essential: true };
  // left out, or into the Emergency fund: it isn't spending, so the switches don't apply
  const isSpending = (k: string) => { const ch = catMap[k]; return !ch || ch.action === "new" || (ch.action === "match" && ch.id !== "cash"); };
  /** Set a switch for every spending category in a list (a group's "all" switch). */
  const setAll = (list: YnabCategory[], key: "inRetirement" | "essential", v: boolean) =>
    setCatOpts((s2) => {
      const next = { ...s2 };
      for (const c of list) { const k = categoryKey(c.group, c.name); if (isSpending(k)) next[k] = { ...opts(k), [key]: v }; }
      return next;
    });
  // investment accounts and loans matched to yours: keep your balance unless you pick YNAB's
  const [useYnabBalance, setUseYnabBalance] = useState<Record<string, boolean>>({});
  const conflicts = useMemo(() => (data ? balanceConflicts(saved, ynabAccounts(data, isoDay(start)), choices) : []), [data, saved, choices]);
  const preview = useMemo(
    () => (data ? buildImport(saved, data, { from, thisMonth, accounts: choices, names, useYnabBalance, categories: catOpts, categoryMap: catMap, groupMap, categoryGroup: catGroup, amounts, removeEmpty, existing, keepBoth, today: isoDay(start) }) : null),
    [data, saved, from, thisMonth, choices, names, useYnabBalance, catOpts, catMap, groupMap, catGroup, amounts, removeEmpty, existing, keepBoth],
  );

  // Unassigned after this import, next to YNAB's Ready to Assign (only the accounts you bring in count on
  // either side), so a difference shows before you import, not after
  const unassignedCheck = (r: ImportResult) => {
    if (!data || !r.plan.budgetPlan) return null;
    const ynab = ynabReadyToAssign(data, thisMonth, isoDay(start), (name) => choices[name]?.action !== "skip");
    if (ynab === null) return null;
    const ids = new Set(r.txns.map((x) => x.id));
    const all = [...existing.filter((x) => !ids.has(x.id) && !r.replaced.includes(x.id)), ...r.txns];
    const p = structuredClone(r.plan);
    applyRegisterBalances(p, all, isoDay(start));
    return { mine: readyToAssignFor(effectivePlan(p, useLimits.getState().rows), all, start, thisMonth), ynab };
  };
  const check = useMemo(() => (preview ? unassignedCheck(preview) : null), [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  // accounts you're leaving out that have budget transactions this month: the budget won't match YNAB's
  const usedThisMonth = (name: string) => (data ? budgetTxnsThisMonth(data, name, thisMonth, isoDay(start)) : 0);
  // your own cash accounts with money that no YNAB account is matched to: their money counts on top of YNAB's
  const matchedIds = new Set(Object.values(choices).flatMap((c) => (c.action === "match" ? [c.id] : [])));
  const unmatchedMine = preview ? saved.accounts.filter((x) => x.type === "cash" && Math.abs(x.balance) >= 0.01 && !matchedIds.has(x.id) && preview.plan.accounts.some((y) => y.id === x.id)) : [];
  const leftOutUsed = data ? ynabAccounts(data, isoDay(start)).filter((a) => choices[a.name]?.action === "skip" && usedThisMonth(a.name) > 0).map((a) => a.name) : [];

  const options = (a: YnabAccount) => {
    // an account here takes one YNAB account: the ones another already took aren't offered
    const takenByOthers = new Set(Object.entries(choices).flatMap(([n, c]) => (n !== a.name && c.action === "match" ? [c.id] : [])));
    const pool0 =
      a.kind === "cash" ? state.accounts.filter((x) => x.type === "cash")
      : a.kind === "card" ? state.debts.filter(isCard)
      : a.kind === "loan" ? state.debts.filter((x) => !isCard(x))
      : state.accounts.filter((x) => x.type !== "cash");
    const pool = pool0.filter((x) => !takenByOthers.has(x.id));
    return [
      ...pool.map((x) => ({ value: "match:" + x.id, label: `Same as ${x.name || "account"}` })),
      { value: "add", label: "Add as a new account" },
      { value: "skip", label: "Leave it out" },
    ];
  };
  const valueOf = (c: AccountChoice | undefined) => (!c ? "add" : c.action === "match" ? "match:" + c.id : c.action);
  const setChoice = (name: string, v: string) => setChoices((s) => ({ ...s, [name]: v.startsWith("match:") ? { action: "match", id: v.slice(6) } : { action: v as "add" | "skip" } }));

  // one import per budget: a second tap (or an import already done on any device) does nothing
  const running = useRef(false);
  const run = () => {
    if (!data || running.current || useStore.getState().importedAt) return;
    running.current = true;
    setConfirming(false);
    const r = buildImport(saved, data, { from, thisMonth, accounts: choices, names, useYnabBalance, categories: catOpts, categoryMap: catMap, groupMap, categoryGroup: catGroup, amounts, removeEmpty, existing, keepBoth, today: isoDay(start) });
    // check Unassigned against YNAB's Ready to Assign, and say plainly if it's off
    const c = unassignedCheck(r);
    const said = !c ? "" : Math.abs(c.mine - c.ynab) < 0.01 ? ` Unassigned is ${money(c.mine)}, the same as YNAB's Ready to Assign.` : ` Unassigned is ${money(c.mine)}; YNAB's Ready to Assign is ${money(c.ynab)}.`;
    importBudget(r.plan, r.txns, r.replaced);
    setDone(`Imported ${r.summary.transactions} transactions and ${r.summary.categoriesAdded + r.summary.categoriesUpdated} categories.${said}${r.summary.notApprovedInYnab ? ` ${r.summary.notApprovedInYnab} to review under Transactions.` : ""}`);
    setDoneNeeds(r.summary.needsCategoryFromYnab + r.summary.needsCategoryLeftOut);
    setData(null);
  };

  const since = from;
  const quietAccounts = data ? accounts.filter((a) => quietAccount(data, a.name, a.balance, since)) : [];
  // accounts you're leaving out (closed, empty, or set to "Nothing") are tucked away under one link. Decided when
  // the list opens, so a row you just changed doesn't jump away; it moves the next time you come back.
  const leftOut = accounts.filter((a) => (tucked ? tucked.has(a.name) : quietAccounts.includes(a)));
  const activeAccounts = accounts.filter((a) => !leftOut.includes(a));
  const importing = accounts.filter((a) => choices[a.name]?.action !== "skip").length;
  useEffect(() => {
    if (!data || tab !== "accounts") return;
    setTucked(new Set(accounts.filter((a) => choices[a.name]?.action === "skip" || quietAccount(data, a.name, a.balance, since)).map((a) => a.name)));
    // only when the list opens (a new file, or coming back to Accounts): not on every change you make in it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab]);
  const unusedCats = data ? categories.filter((c) => unusedCategory(data, c, since)) : [];
  const activeCats = categories.filter((c) => !unusedCats.includes(c));
  const accountRow = (a: YnabAccount, i: number, showKind = false) => (
    <View key={a.name} style={{ gap: 4 }}>
      {i > 0 && wide ? <Divider /> : null}
      {/* phones: the name and balance on one line, the dropdown full width below it */}
      <View style={wide ? styles.row : [styles.phoneRow, { backgroundColor: t.surface2, borderColor: t.border }]}>
        <View style={wide ? { flex: 1, minWidth: 0 } : [styles.row, { alignItems: "baseline" }]}>
          <Text style={[type.body, { color: choices[a.name]?.action === "skip" ? t.text3 : t.text, fontWeight: "600", ...(wide ? null : { flex: 1, minWidth: 0 }) }]} numberOfLines={1}>{a.name}</Text>
          {/* under a section heading the kind goes without saying */}
          <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
            {showKind ? `${KIND_LABEL[a.kind]} · ` : ""}{a.kind === "card" || a.kind === "loan" ? `Owe ${money(Math.max(0, -a.balance))}` : money(a.balance)}
          </Text>
        </View>
        {a.upcoming ? (
          <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
            {a.upcoming > 0 ? "+" : "−"}{money(Math.abs(a.upcoming))} upcoming · {a.kind === "card" || a.kind === "loan" ? `owe ${money(Math.max(0, -(a.balance + a.upcoming)))}` : money(a.balance + a.upcoming)} after
          </Text>
        ) : null}
        {/* wide: the choice and the new account's company and name each get a column of their own, so rows line up */}
        <View style={wide ? { width: 260 } : null}>
          <Select label={`${a.name}: what it is here`} value={valueOf(choices[a.name])} options={options(a)} onChange={(v) => setChoice(a.name, v)} />
        </View>
        {(choices[a.name]?.action ?? "add") === "add" ? (
          // a new account: its company and name here (both editable)
          <View style={wide ? { width: 380 } : { gap: 2, alignSelf: "stretch" }}>
            {wide ? null : <Text style={[type.caption, { color: t.text3 }]}>Company and name here</Text>}
            <View style={[styles.row, { gap: space.sm }]}>
              <View style={{ flex: 2, minWidth: 0 }}>
                <TextField label={`${a.name}: company`} placeholder="Company" value={names[a.name]?.company ?? ""} onChange={(v) => setName(a.name, { company: v })} />
              </View>
              <View style={{ flex: 3, minWidth: 0 }}>
                <TextField label={`${a.name}: name here`} placeholder="Name" value={names[a.name]?.name ?? a.name} onChange={(v) => setName(a.name, { name: v })} />
              </View>
            </View>
          </View>
        ) : wide ? (
          <View style={{ width: 380 }} />
        ) : null}
      </View>
      {choices[a.name]?.action === "skip" && usedThisMonth(a.name) > 0 ? (
        <Text style={[type.caption, { color: t.bad }]}>
          Has {usedThisMonth(a.name)} budget {usedThisMonth(a.name) === 1 ? "transaction" : "transactions"} this month. Left out, your budget won't match YNAB's.
        </Text>
      ) : null}
      {(() => {
        // matched to one of yours with a different balance: which one to keep
        const c = conflicts.find((x) => x.name === a.name);
        if (!c) return null;
        const show = (v: number) => (c.owed ? `owe ${money(v)}` : money(v));
        return (
          <View style={[styles.row, { gap: 4, flexWrap: "wrap", paddingHorizontal: wide ? 0 : space.sm }]}>
            <Text style={[type.caption, { color: t.text3 }]}>Balance</Text>
            <Select
              plain
              label={`${a.name}: balance to keep`}
              value={useYnabBalance[a.name] ? "ynab" : "yours"}
              options={[{ value: "yours", label: `Keep yours: ${show(c.yours)}` }, { value: "ynab", label: `Use YNAB's: ${show(c.ynab)}` }]}
              onChange={(v) => setUseYnabBalance((m) => ({ ...m, [a.name]: v === "ynab" }))}
            />
          </View>
        );
      })()}
    </View>
  );
  const acctName = (id: string) => saved.accounts.find((a) => a.id === id)?.name ?? saved.debts.find((d) => d.id === id)?.name ?? "Account";
  const catName = (id?: string) => (!id ? "No category" : id === "ready" ? "Unassigned" : id === "cash" ? "Emergency fund" : saved.budget.find((b) => b.id === id)?.name ?? preview?.plan.budget.find((b) => b.id === id)?.name ?? "Category");
  const day = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const mine = saved.budget.filter((b) => !b.accountId);
  const catOptions = [
    { value: "new", label: "A new category" },
    { value: "hidden", label: "A hidden category", hint: "Keeps its transactions, not on your budget" },
    ...mine.map((b) => ({ value: "match:" + b.id, label: `Your ${b.name || "category"}`, hint: b.group })),
    { value: "match:cash", label: "Your Emergency fund" },
    { value: "skip", label: "Nothing (left out)" },
  ];
  const yourGroups = groupOrder(saved.budget).filter((g) => !!g);
  const sameGroup = (g: string) => yourGroups.find((x) => x.trim().toLowerCase() === g.trim().toLowerCase());
  const groupTarget = (g: string) => groupMap[groupKey(g)] ?? sameGroup(g) ?? g;
  const groupOptions = (g: string) => [
    ...(sameGroup(g) ? [] : [{ value: g, label: `${g} (new group)` }]),
    ...yourGroups.map((x) => ({ value: x, label: x })),
  ];
  const rowGroup = (k: string, g: string) => catGroup[k] ?? groupTarget(g);
  const allGroups = () => {
    const out: string[] = [...yourGroups];
    for (const c of categories) if (c.group) { const x = groupTarget(c.group); if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x); }
    for (const x of Object.values(catGroup)) if (!out.includes(x)) out.push(x);
    return out.map((x) => ({ value: x, label: x, ...(yourGroups.includes(x) ? {} : { hint: "New group" }) }));
  };
  const setRowGroup = (k: string, g: string, v: string) =>
    setCatGroup(({ [k]: _, ...m }) => (v === groupTarget(g) ? m : { ...m, [k]: v }));
  const catValue = (c: CategoryChoice | undefined) => (!c ? "new" : c.action === "match" ? "match:" + c.id : c.action);
  const setCat = (k: string, v: string) => setCatMap((m) => ({ ...m, [k]: v.startsWith("match:") ? { action: "match", id: v.slice(6) } : { action: v as "new" | "hidden" | "skip" } }));
  const categoryRow = (c: (typeof categories)[number], grip?: ReactNode) => {
    const k = categoryKey(c.group, c.name);
    const o = opts(k);
    const ch = catMap[k];
    // left out, or into the Emergency fund: it isn't spending, so the switches don't apply
    const spending = !ch || ch.action === "new" || (ch.action === "match" && ch.id !== "cash");
    const perMonth = !offBudget(ch) ? (
      <View style={[styles.row, { gap: 4 }, wide ? { width: 190 } : null, wide ? { justifyContent: "flex-end" } : null]}>
        <InlineMoney compact={!wide} label={`${c.name}: a month`} value={amounts[k] ?? c.average} onChange={(v) => setAmounts((m) => ({ ...m, [k]: v }))} />
        <Text style={[type.caption, { color: t.text3 }]}>/mo</Text>
      </View>
    ) : null;
    // the group it lands in (phones: in the full-width part below, so the switches don't squeeze it)
    const inGroup = !offBudget(ch) && (ch?.action !== "match" || ch.id !== "cash") ? (
      <View style={[styles.row, { gap: 4, alignSelf: "flex-start", maxWidth: "100%", overflow: "hidden" }]}>
        <Text style={[type.caption, { color: catGroup[k] ? t.accent : t.text3 }]}>{catGroup[k] ? "Moved to" : "In"}</Text>
        <Select plain label={`${c.name}: group`} value={rowGroup(k, c.group)} options={allGroups()} onChange={(v) => setRowGroup(k, c.group, v)} />
      </View>
    ) : null;
    const reset = amounts[k] !== undefined && Math.abs(amounts[k]! - c.average) > 0.5 ? (
      <Pressable onPress={() => setAmounts(({ [k]: _, ...m }) => m)} hitSlop={6} style={{ alignSelf: "flex-start" }}>
        <Text style={[type.caption, { color: t.accent }]}>Reset to YNAB's {money(c.average, { whole: true })}</Text>
      </Pressable>
    ) : null;
    const setOpt = (patch: Partial<typeof o>) => setCatOpts((s2) => ({ ...s2, [k]: { ...o, ...patch } }));
    // phones: the name and amount on top, then each choice on its own labelled line, so nothing floats
    // away from the category it belongs to
    if (!wide) {
      const groupLine = !offBudget(ch) && (ch?.action !== "match" || ch.id !== "cash");
      return (
        <View key={k} style={[styles.phoneRow, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={[styles.row, { alignItems: "flex-start" }]}>
            {grip}
            <Text style={[type.body, { flex: 1, minWidth: 0, color: ch?.action === "skip" ? t.text3 : t.text, fontWeight: "600" }]}>{c.name}</Text>
            {perMonth}
          </View>
          {reset}
          <View style={styles.field}>
            <Text style={[type.caption, { color: t.text3 }]}>Becomes</Text>
            <Select plain label={`${c.name}: becomes`} value={catValue(ch)} options={catOptions} onChange={(v) => setCat(k, v)} />
          </View>
          {/* the card already says its group: a line only once it's moved elsewhere */}
          {groupLine && catGroup[k] ? (
            <View style={styles.field}>
              <Text style={[type.caption, { color: t.accent }]}>Moved to group</Text>
              <Select plain label={`${c.name}: group`} value={rowGroup(k, c.group)} options={allGroups()} onChange={(v) => setRowGroup(k, c.group, v)} />
            </View>
          ) : null}
          {spending ? (
            <View style={[styles.row, { gap: space.xl, flexWrap: "wrap" }]}>
              <View style={styles.row}>
                <InlineSwitch label={`${c.name}: still paid after retiring`} value={o.inRetirement} onChange={(v) => setOpt({ inRetirement: v })} />
                <Text style={[type.caption, { color: t.text2 }]}>After retiring</Text>
              </View>
              <View style={styles.row}>
                <InlineSwitch label={`${c.name}: essential`} value={o.essential} onChange={(v) => setOpt({ essential: v })} />
                <Text style={[type.caption, { color: t.text2 }]}>Essential</Text>
              </View>
            </View>
          ) : (
            <Text style={[type.caption, { color: t.text3 }]}>{ch?.action === "skip" ? "Not brought in" : ch?.action === "hidden" ? "Comes in hidden: keeps its transactions, not on your budget or plan" : "Savings, not spending"}</Text>
          )}
          {/* move just this one to another group, without dragging */}
          {groupLine && !catGroup[k] ? (
            <View style={{ alignSelf: "flex-start" }}>
              <Select plain label={`${c.name}: move to group`} value="" placeholder="Move to another group" options={allGroups().filter((x) => x.value !== rowGroup(k, c.group))} onChange={(v) => setRowGroup(k, c.group, v)} />
            </View>
          ) : null}
        </View>
      );
    }
    return (
      <View key={k} style={[styles.catRow, { borderTopColor: t.border }]}>
        <View style={styles.row}>
          {grip}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.body, { color: ch?.action === "skip" ? t.text3 : t.text, fontWeight: "600" }]} numberOfLines={1}>{c.name}</Text>
            {inGroup}
            {reset}
          </View>
          {perMonth}
          <View style={{ width: 220 }}>
            <Select plain label={`${c.name}: becomes`} value={catValue(ch)} options={catOptions} onChange={(v) => setCat(k, v)} />
          </View>
          {spending ? (
            <>
              <View style={styles.col}><InlineSwitch label={`${c.name}: still paid after retiring`} value={o.inRetirement} onChange={(v) => setOpt({ inRetirement: v })} /></View>
              <View style={styles.col}><InlineSwitch label={`${c.name}: essential`} value={o.essential} onChange={(v) => setOpt({ essential: v })} /></View>
            </>
          ) : (
            <Text style={[type.caption, { color: t.text3, width: 84 * 2 + space.sm, textAlign: "center" }]}>{ch?.action === "skip" ? "Not brought in" : ch?.action === "hidden" ? "Comes in hidden: keeps its transactions, not on your budget or plan" : "Savings, not spending"}</Text>
          )}
        </View>
      </View>
    );
  };
  // pieces of the page. Phones and tablets: one column, Import in a bar pinned at the bottom. Wide:
  // the review list on the left, and on the right a summary card with Import that stays in view.
  const loaded = !!(data && preview);
  const doneNote = done ? (
    <View style={{ gap: space.sm }}>
      <Text role="status" style={[type.label, { color: t.good }]}>{done}</Text>
      <View style={[styles.row, { flexWrap: "wrap" }]}>
        {setup ? (
          <Button title="Continue setup" tone="primary" onPress={backToSetup} />
        ) : (
          <>
            <Button title="Go to Budget" tone="primary" onPress={() => router.navigate("/budget")} />
            {doneNeeds ? <Button title={`Categorize ${doneNeeds} transactions`} onPress={() => router.navigate("/budget?view=transactions&needs=1")} /> : null}
          </>
        )}
      </View>
    </View>
  ) : null;
  const errorNote = error ? <Text role="alert" style={[type.label, { color: t.bad }]}>{error}</Text> : null;
  // already imported here: no second import; undo it for a while, then start over to bring it in again
  const importedCard = imported && !data ? (
    <View style={{ gap: space.md }}>
      <ImportUndoCard onUndone={() => { setDone(""); setUndone(true); }}>
        {doneNote}
        {setup && !done ? <Button title="Continue setup" tone="primary" onPress={backToSetup} style={{ alignSelf: "flex-start" }} /> : null}
      </ImportUndoCard>
      {/* after setup: newer transactions from YNAB, for using both apps for a while */}
      {setup ? null : <YnabUpdateCard />}
    </View>
  ) : null;
  const headCard = importedCard ?? (!loaded ? (
    <Card style={{ gap: space.sm }}>
      {undone ? <Text role="status" style={[type.label, { color: t.good }]}>Undone. Your budget and transactions are back to how they were before the import.</Text> : null}
      <Text style={[type.body, { color: t.text2 }]}>
        In YNAB, open your budget's menu and choose Export budget. It downloads a zip; pick it here. You'll choose what comes in before anything changes{setup ? ", and check it all in the rest of setup" : ""}.
      </Text>
      {Platform.OS === "web" ? (
        <Button title="Choose YNAB export" tone="primary" icon="plus" onPress={pick} style={{ alignSelf: "flex-start" }} />
      ) : (
        <Text style={[type.caption, { color: t.text3 }]}>Importing works in the web app for now.</Text>
      )}
      {errorNote}
      {doneNote}
    </Card>
  ) : (
    <Card style={{ gap: space.md }}>
      <View style={[styles.row, { flexWrap: "wrap", justifyContent: "space-between" }]}>
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: t.text3 }]}>From</Text>
          <Text style={[type.label, { color: t.text, fontWeight: "700" }]} numberOfLines={1}>{fileName || "Your YNAB export"}</Text>
        </View>
        <Button title="Pick a different file" tone="ghost" icon="plus" onPress={pick} style={{ minHeight: 36 }} />
      </View>
      {errorNote}
      <View style={[styles.row, { flexWrap: "wrap", alignItems: "center", gap: space.md }]}>
        <Text style={[type.label, { color: t.text2 }]}>Bring in from</Text>
        <MonthField label="Bring in from" value={startMonth} min={oldest} max={thisMonth} onChange={(m) => setRange(m === oldest ? "all" : m)} />
        <Text style={[type.caption, { color: t.text3 }]}>{monthCount > 0 ? `${monthCount} month${monthCount === 1 ? "" : "s"}${startMonth === oldest ? " · everything in the export" : ""}` : ""}</Text>
        {oldest && startMonth !== oldest ? (
          <Pressable role="button" onPress={() => setRange("all")} hitSlop={6}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Everything (from {ymText(oldest)})</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>
        Each account starts with its balance on the first day{from ? ` (${ymText(from)})` : ""}; transactions and what you assigned come in from then on.
      </Text>
      {monthCount > 6 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: 12, borderWidth: 1, borderColor: t.accent, backgroundColor: t.accentSoft, flexWrap: "wrap" }}>
          <Icon name="info" size={18} color={t.accent} />
          <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
            <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>{monthCount} months is a lot to bring in</Text>
            <Text style={[type.caption, { color: t.text2 }]}>
              2 or 3 is usually enough to start. Older months mostly add history to scroll through, and only this month's and last month's transactions
              ever need a category.
            </Text>
          </View>
          {/* two months back, plus this one: 3 months */}
          {months.includes(recentMonths(thisMonth, 2)[0]!) ? (
            <Button title="Use the last 3 months" onPress={() => setRange(recentMonths(thisMonth, 2)[0]!)} />
          ) : null}
        </View>
      ) : null}
      {doneNote}
    </Card>
  ));
  const review = data && preview ? (
    <>
          <View onLayout={(e) => setTabsH(Math.round(e.nativeEvent.layout.height))} style={[styles.pinned, sticky(0, t.bg)]}>
          {(() => {
            const tabs = [
              { value: "accounts" as const, label: `Accounts (${importing})` },
              { value: "categories" as const, label: `Categories (${activeCats.length})` },
              ...(preview.matches.length ? [{ value: "matches" as const, label: `Matches (${preview.matches.length})` }] : []),
            ];
            // three don't fit a phone's width: a dropdown there
            return tabs.length > 2 && contentWidth < 600
              ? <Select label="What to review" options={tabs} value={tab} onChange={setTab} />
              : <Segmented label="What to review" options={tabs} value={tab} onChange={setTab} />;
          })()}
          </View>

          {tab === "accounts" ? (
            <Card style={{ gap: space.sm }}>
              <View style={[styles.row, { alignItems: "flex-start" }]}>
                <Text style={[type.caption, { color: t.text3, flex: 1 }]}>Pick what each YNAB account is here.{wide ? " A new one gets the company and name on the right." : ""}</Text>
                <InfoTip text={ACCT_INFO} label="accounts" open={acctTip} onToggle={setAcctTip} />
              </View>
              {acctTip ? <InfoText text={ACCT_INFO} /> : null}
              {KIND_ORDER.map((k) => {
                const list = activeAccounts.filter((a) => a.kind === k);
                if (!list.length) return null;
                return (
                  <View key={k} style={{ gap: 2, marginTop: space.xs }}>
                    <Text style={[type.overline, { color: t.text2 }]}>
                      {KIND_SECTION[k]} <Text style={{ color: t.text3 }}>({list.length})</Text>
                    </Text>
                    {k === "invest" || k === "loan" ? <Text style={[type.caption, { color: t.text3 }]}>Balance only: their transactions don't come in.</Text> : null}
                    {list.map((a, i) => accountRow(a, i))}
                  </View>
                );
              })}
              {leftOut.length ? (
                <>
                  <Divider />
                  <Pressable role="button" aria-expanded={showQuiet} onPress={() => setShowQuiet((v) => !v)} hitSlop={6}>
                    <Text style={[type.label, { color: t.accent, fontWeight: "700" }]}>
                      {showQuiet ? "Hide" : "Show"} {leftOut.length} {leftOut.length === 1 ? "account" : "accounts"} you're leaving out
                    </Text>
                  </Pressable>
                  {showQuiet ? (
                    <>
                      <Text style={[type.caption, { color: t.text3 }]}>Closed, empty, or set to Nothing. Change one to bring it in.</Text>
                      {leftOut.map((a, i) => accountRow(a, i, true))}
                    </>
                  ) : null}
                </>
              ) : null}
            </Card>
          ) : null}

          {tab === "categories" ? (
            <Card style={{ gap: space.sm }}>
              <View style={[styles.row, { alignItems: "flex-start" }]}>
                <Text style={[type.caption, { color: t.text3, flex: 1 }]}>
                  Each comes in with what you assigned a month lately. Pick what each one becomes in your budget.
                </Text>
                <InfoTip text={CAT_INFO} label="categories" open={catTip} onToggle={setCatTip} />
              </View>
              {catTip ? <InfoText text={CAT_INFO + (wide ? "" : " On a phone, tap Reorder first to drag.")} /> : null}
              {wide ? (
                <View style={[styles.row, { paddingVertical: space.xs }, sticky(tabsH, t.surface)]}>
                  <Text style={[type.caption, { color: t.text3, flex: 1 }]}>Category</Text>
                  <Text style={[type.caption, { color: t.text3, width: 190, textAlign: "right", paddingRight: 28 }]}>A month</Text>
                  <Text style={[type.caption, { color: t.text3, width: 220, textAlign: "right", paddingRight: 18 }]}>Becomes</Text>
                  <Text style={[type.caption, styles.col, { color: t.text3 }]}>After retiring</Text>
                  <Text style={[type.caption, styles.col, { color: t.text3 }]}>Essential</Text>
                </View>
              ) : (
                <View style={{ alignSelf: "flex-end" }}><ReorderToggle on={reorder} onChange={setReorder} /></View>
              )}
              {(() => {
                const cards = [...new Set(activeCats.map((c) => c.group))];
                cardTargetRef.current = groupTarget;
                const cardOf = (c: (typeof activeCats)[number]) => {
                  const moved = catGroup[categoryKey(c.group, c.name)];
                  return (moved && cards.find((g) => g && groupTarget(g) === moved)) ?? c.group;
                };
                const rows: Record<string, typeof activeCats> = {};
                for (const g of cards) rows[g] = activeCats.filter((c) => cardOf(c) === g);
                cardRowsRef.current = rows;
                return cards;
              })().map((g) => (
                <View key={g} style={[styles.group, { borderColor: t.border, backgroundColor: t.surface2 }]}>
                  <View style={[styles.row, { flexWrap: "wrap", justifyContent: "space-between", paddingBottom: space.sm }]}>
                    <View style={[styles.row, { flexShrink: 1, gap: space.sm }]}>
                      <View style={[styles.groupDot, { backgroundColor: t.accent }]} />
                      <Text style={[type.heading, { color: t.text, flexShrink: 1 }]} numberOfLines={1}>{g || "No group"}</Text>
                      <View style={[styles.pill, { backgroundColor: t.surface }]}>
                        <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]}>{cardRowsRef.current[g]?.length ?? 0}</Text>
                      </View>
                    </View>
                    {/* same name as the card: just say so, with a way to change it; a dropdown only once it goes elsewhere */}
                    {g && groupTarget(g).trim().toLowerCase() === g.trim().toLowerCase() ? (
                      <View style={[styles.row, { flexShrink: 1, gap: space.xs }]}>
                        <Text style={[type.caption, { color: t.text3 }]}>{sameGroup(g) ? "Your group" : "New group"} ·</Text>
                        <View style={{ minWidth: 64 }}>
                          <Select plain label={`${g}: lands in group`} value="" placeholder="Change" options={groupOptions(g).filter((o) => o.value.trim().toLowerCase() !== g.trim().toLowerCase())} onChange={(v) => setGroupMap((m) => ({ ...m, [groupKey(g)]: v }))} />
                        </View>
                      </View>
                    ) : g ? (
                      <View style={[styles.row, { flexShrink: 1 }]}>
                        <Text style={[type.caption, { color: t.accent }]}>Into your group</Text>
                        <Select label={`${g}: lands in group`} value={groupTarget(g)} options={groupOptions(g)} onChange={(v) => setGroupMap((m) => ({ ...m, [groupKey(g)]: v }))} />
                      </View>
                    ) : null}
                  </View>
                  {(() => {
                    // the whole group at once: on when every spending category in it is on
                    const list = (cardRowsRef.current[g] ?? []).filter((c) => isSpending(categoryKey(c.group, c.name)));
                    if (list.length < 2) return null;
                    const all = (key: "inRetirement" | "essential") => list.every((c) => opts(categoryKey(c.group, c.name))[key]);
                    const sw = (key: "inRetirement" | "essential", name: string) => (
                      <InlineSwitch label={`${g || "No group"}: all ${name.toLowerCase()}`} value={all(key)} onChange={(v) => setAll(list, key, v)} />
                    );
                    return wide ? (
                      <View style={[styles.row, { paddingBottom: space.sm }]}>
                        <Text style={[type.caption, { color: t.text3, flex: 1, textAlign: "right" }]}>Whole group</Text>
                        <View style={styles.col}>{sw("inRetirement", "After retiring")}</View>
                        <View style={styles.col}>{sw("essential", "Essential")}</View>
                      </View>
                    ) : (
                      <View style={[styles.row, { gap: space.xl, flexWrap: "wrap", paddingBottom: space.sm }]}>
                        <View style={styles.row}>{sw("inRetirement", "After retiring")}<Text style={[type.caption, { color: t.text2 }]}>All after retiring</Text></View>
                        <View style={styles.row}>{sw("essential", "Essential")}<Text style={[type.caption, { color: t.text2 }]}>All essential</Text></View>
                      </View>
                    );
                  })()}
                  <DragList
                    zone={{ set: zone, id: g }}
                    grips={wide || reorder}
                    count={cardRowsRef.current[g]?.length ?? 0}
                    keyOf={(n) => categoryKey(cardRowsRef.current[g]![n]!.group, cardRowsRef.current[g]![n]!.name)}
                    nameOf={(n) => cardRowsRef.current[g]![n]!.name}
                    onMove={() => {}}
                    renderItem={(n, grip) => categoryRow(cardRowsRef.current[g]![n]!, grip)}
                  />
                </View>
              ))}
              {unusedCats.length ? (
                <>
                  <Divider />
                  <Pressable role="button" aria-expanded={showUnused} onPress={() => setShowUnused((v) => !v)} hitSlop={6}>
                    <Text style={[type.label, { color: t.accent, fontWeight: "700" }]}>
                      {showUnused ? "Hide" : "Show"} {unusedCats.length} {unusedCats.length === 1 ? "category" : "categories"} you haven't used lately (they come in hidden)
                    </Text>
                  </Pressable>
                  {showUnused ? unusedCats.map(categoryRow) : null}
                </>
              ) : null}
              <Divider />
              <ToggleRow label="Remove my $0 categories YNAB doesn't have" hint="The starter categories you never filled in" value={removeEmpty} onChange={setRemoveEmpty} />
            </Card>
          ) : null}

          {tab === "matches" && preview.matches.length ? (
            <Card style={{ gap: space.sm }}>
              <Text style={[type.caption, { color: t.text3 }]}>
                These you added here look like ones in YNAB (same account and amount, dates within 3 days). Same transaction: YNAB's copy replaces yours. Off: both stay.
              </Text>
              {preview.matches.map(({ mine, ynab }, i) => {
                const same = !keepBoth.includes(mine.id);
                return (
                  <View key={mine.id} style={{ gap: 4 }}>
                    {i > 0 ? <Divider /> : null}
                    <View style={styles.row}>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={[type.body, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
                          {money(mine.amount)} · {acctName(mine.accountId)}
                        </Text>
                        <Text style={[type.caption, { color: t.text2 }]} numberOfLines={1}>Yours: {day(mine.date)} · {mine.payee || "No payee"} · {mine.splits?.length ? `Split (${mine.splits.length})` : catName(mine.categoryId)}</Text>
                        <Text style={[type.caption, { color: t.text2 }]} numberOfLines={1}>YNAB: {day(ynab.date)} · {ynab.payee || (ynab.transferAccountId ? "Transfer" : "No payee")} · {ynab.splits?.length ? `Split (${ynab.splits.length})` : catName(ynab.categoryId)}</Text>
                      </View>
                      <View style={{ alignItems: "center", gap: 2 }}>
                        <InlineSwitch label={`${mine.payee || "Transaction"} ${money(mine.amount)}: same transaction`} value={same} onChange={(v) => setKeepBoth((k) => (v ? k.filter((x) => x !== mine.id) : [...k, mine.id]))} />
                        <Text style={[type.caption, { color: t.text3 }]}>{same ? "Same" : "Keep both"}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </Card>
          ) : null}
    </>
  ) : null;
  const stats = preview ? [
    { n: preview.summary.transactions, label: "Transactions", sub: preview.summary.transactionsMatched ? `replacing ${preview.summary.transactionsMatched} of yours` : "with starting balances" },
    { n: preview.summary.categoriesAdded + preview.summary.categoriesUpdated, label: "Categories", sub: `${preview.summary.categoriesAdded} new · ${preview.summary.categoriesUpdated} matched${preview.summary.categoriesHidden ? ` · ${preview.summary.categoriesHidden} hidden` : ""}${preview.summary.categoriesSkipped ? ` · ${preview.summary.categoriesSkipped} left out` : ""}` },
    { n: preview.summary.accountsAdded, label: "New accounts", sub: "the rest matched or left out" },
    { n: preview.summary.months, label: preview.summary.months === 1 ? "Month assigned" : "Months assigned", sub: "what you gave each category" },
  ] : [];
  // what happens besides the numbers: one line each, with an icon (to do, nothing to do, removed, undo)
  const s = preview?.summary;
  const toSort = s ? s.needsCategoryFromYnab + s.needsCategoryLeftOut : 0;
  const noteRow = (key: string, icon: IconName, color: string, title: string, detail?: string) => (
    <View key={key} style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 1 }}>
        <Icon name={icon} size={16} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[type.label, { color: t.text }]}>{title}</Text>
        {detail ? <Text style={[type.caption, { color: t.text3 }]}>{detail}</Text> : null}
      </View>
    </View>
  );
  const notes = s ? (
    <View style={{ gap: space.md, padding: space.md, borderRadius: 12, backgroundColor: t.surface2 }}>
      {check
        ? Math.abs(check.mine - check.ynab) < 0.01
          ? noteRow("ynab", "check", t.good, `Unassigned will match YNAB: ${money(check.mine)}`, "The same as YNAB's Ready to Assign this month.")
          : noteRow(
              "ynab",
              "info",
              t.bad,
              `Unassigned will be ${money(check.mine)}. YNAB shows ${money(check.ynab)}`,
              [
                unmatchedMine.length
                  ? `Your own ${unmatchedMine.map((x) => `${fullName(x, "Cash")} (${money(x.balance)})`).join(", ")} ${unmatchedMine.length === 1 ? "isn't" : "aren't"} matched to a YNAB account, so ${unmatchedMine.length === 1 ? "its" : "their"} money counts on top of YNAB's. If ${unmatchedMine.length === 1 ? "it's" : "they're"} the same as one of YNAB's, pick "Same as" for it above.`
                  : "",
                leftOutUsed.length
                  ? `You're leaving out ${leftOutUsed.join(", ")}, which ${leftOutUsed.length === 1 ? "has" : "have"} budget transactions this month. Bring ${leftOutUsed.length === 1 ? "it" : "them"} in to match.`
                  : "",
              ].filter(Boolean).join(" ") || "YNAB counts a few things differently from Coastwise.",
            )
        : null}
      {toSort
        ? noteRow(
            "sort",
            "receipt",
            t.accent,
            `${toSort} recent ${toSort === 1 ? "transaction" : "transactions"} to categorize`,
            [
              s.needsCategoryFromYnab ? `${s.needsCategoryFromYnab} had none in YNAB` : "",
              s.needsCategoryLeftOut ? `${s.needsCategoryLeftOut} ${s.needsCategoryLeftOut === 1 ? "is" : "are"} in categories you left out` : "",
            ].filter(Boolean).join(", ") + ". You'll find them under Transactions.",
          )
        : null}
      {s.notApprovedInYnab
        ? noteRow(
            "review",
            "check",
            t.accent,
            `${s.notApprovedInYnab} ${s.notApprovedInYnab === 1 ? "transaction" : "transactions"} to review`,
            "Not approved in YNAB yet, so like YNAB they don't count in balances or your budget until you accept them. You'll find them under Transactions → To review.",
          )
        : null}
      {s.olderWithoutCategory || s.transfersOutside
        ? noteRow(
            "rest",
            "check",
            t.good,
            toSort ? "Nothing to do for the rest" : "Nothing to categorize",
            [
              s.olderWithoutCategory ? `${s.olderWithoutCategory} older ones without a category stay as history` : "",
              s.transfersOutside ? `${s.transfersOutside} transfers to accounts you left out stay as transfers` : "",
            ].filter(Boolean).join(" · "),
          )
        : null}
      {s.categoriesRemoved
        ? noteRow("cats", "trash", t.text3, `${s.categoriesRemoved} empty starter ${s.categoriesRemoved === 1 ? "category" : "categories"} will be removed`, "YNAB doesn't have them, and they have nothing in them.")
        : null}
      {s.accountsRemoved
        ? noteRow("accts", "wallet", t.text3, s.accountsRemoved === 1 ? "Your empty checking/savings account is replaced by YNAB's" : `${s.accountsRemoved} empty checking/savings accounts are replaced by YNAB's`)
        : null}
      {future
        ? noteRow(
            "future",
            "calendar",
            t.text3,
            `${future} scheduled ${future === 1 ? "transaction comes" : "transactions come"} in as upcoming`,
            "They're dated after today, so they don't change your balances or spending until their day.",
          )
        : null}
      {noteRow("undo", "back", t.text3, "You can undo the import for 30 days", setup ? undefined : "Your other transactions stay as they are.")}
    </View>
  ) : null;
  const confirmBox = preview ? (
    <View style={{ gap: space.sm, flex: 1, minWidth: 180 }}>
      <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Import these now?</Text>
      <Text style={[type.caption, { color: t.text2 }]}>
        {preview.summary.transactions} transactions{preview.summary.transactionsMatched ? ` (replacing ${preview.summary.transactionsMatched} of yours)` : ""}, {preview.summary.categoriesAdded + preview.summary.categoriesUpdated} categories and {preview.summary.accountsAdded} new accounts come into your plan.
      </Text>
    </View>
  ) : null;
  const actions = confirming ? (
    <View style={[styles.row, { flexWrap: "wrap" }]}>
      <Button title="Yes, import" tone="primary" onPress={run} style={{ minHeight: 40 }} />
      <Button title="Cancel" tone="ghost" onPress={() => setConfirming(false)} style={{ minHeight: 40 }} />
    </View>
  ) : (
    <Button title="Import" tone="primary" onPress={() => setConfirming(true)} style={{ minHeight: 40 }} />
  );

  // wide: everything about the result in one card on the right, Import at its foot
  const sideCard = preview ? (
    <Card style={{ gap: space.md, ...(confirming ? { borderColor: t.accent } : null) }}>
      <Text style={[type.heading, { color: t.text }]}>What comes in</Text>
      <View style={styles.stats}>
        {stats.map((x) => (
          <View key={x.label} style={[styles.statSmall, { backgroundColor: t.surface2 }]}>
            <Text style={[type.heading, { color: t.text, fontVariant: ["tabular-nums"] }]}>{x.n}</Text>
            <Text style={[type.caption, { color: t.text, fontWeight: "700" }]}>{x.label}</Text>
            <Text style={[type.caption, { color: t.text3 }]} numberOfLines={2}>{x.sub}</Text>
          </View>
        ))}
      </View>
      {notes}
      <Divider />
      {confirming ? confirmBox : null}
      {actions}
    </Card>
  ) : null;

  // one column: the summary, then a bar pinned at the bottom with Import
  const whatCard = preview ? (
    <Card style={{ gap: space.md }}>
      <Text style={[type.heading, { color: t.text }]}>What comes in</Text>
      {/* one short line each: the bar below already has the totals */}
      <View>
        {stats.map((x, i) => (
          <View key={x.label} style={[styles.statLine, i > 0 ? { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth } : null]}>
            <Text style={[type.label, { color: t.text, fontWeight: "700", width: 44, fontVariant: ["tabular-nums"] }]}>{x.n}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.label, { color: t.text }]}>{x.label}</Text>
              <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>{x.sub}</Text>
            </View>
          </View>
        ))}
      </View>
      {notes}
    </Card>
  ) : null;
  const importBar = preview ? (
    <View style={[styles.bottomBar, { borderColor: confirming ? t.accent : t.border }, stickyBottom(t.surface)]}>
      {confirming ? (
        <>
          {confirmBox}
          {actions}
        </>
      ) : (
        <>
          <Text style={[type.caption, { color: t.text2, flex: 1, minWidth: 0 }]} numberOfLines={2}>
            {preview.summary.transactions} transactions · {preview.summary.categoriesAdded + preview.summary.categoriesUpdated} categories · {preview.summary.accountsAdded} new account{preview.summary.accountsAdded === 1 ? "" : "s"}
            {toSort ? <Text style={{ color: t.warn }}> · {toSort} need a category</Text> : null}
          </Text>
          {actions}
        </>
      )}
    </View>
  ) : null;
  const trademark = <Text style={[type.caption, { color: t.text3 }]}>Coastwise isn't affiliated with YNAB. YNAB is a trademark of its owner.</Text>;

  return (
    <Screen title="Import from YNAB" // back where you came from (Budget, say), else the Money list
      back={setup ? backToSetup : () => router.navigate((isAppPath(backTo) ? backTo : "/money") as never)} hideSettings={setup} narrow={!(wide && loaded)}>
      {headCard}
      {wide && loaded ? (
        <View style={styles.columns}>
          <View style={{ flex: 1, minWidth: 0, gap: space.lg }}>{review}</View>
          <View style={[styles.side, sticky(0, t.bg)]}>{sideCard}</View>
        </View>
      ) : loaded ? (
        <>
          {review}
          {whatCard}
          {importBar}
        </>
      ) : null}
      {trademark}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  col: { width: 84, alignItems: "center", textAlign: "center" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  catRow: { gap: 2, paddingVertical: space.xs, borderTopWidth: StyleSheet.hairlineWidth },
  // phones: each category its own small panel, with space between them
  phoneRow: { gap: 6, paddingHorizontal: space.md, paddingVertical: space.sm, marginBottom: space.sm, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  field: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  note: { borderWidth: 1, borderRadius: 10, padding: space.md, gap: space.sm },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: space.md, paddingVertical: space.sm, marginTop: space.xs },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: space.lg },
  side: { width: 360, gap: space.lg },
  pinned: { paddingVertical: space.xs, marginVertical: -space.xs },
  bottomBar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, borderWidth: 1, borderRadius: 12, paddingHorizontal: space.md, paddingVertical: space.sm },
  statLine: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6 },
  statSmall: { flexGrow: 1, flexBasis: 130, borderRadius: 10, paddingHorizontal: space.md, paddingVertical: space.sm, gap: 1 },
});
