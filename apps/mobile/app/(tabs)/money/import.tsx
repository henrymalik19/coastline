/**
 * Import from YNAB: pick its export, then choose which months to bring in, what each of its
 * accounts is here (match, add or skip), and which categories you'd still pay after retiring and
 * which are essential. Nothing changes until you press Import.
 */
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, InlineMoney, InlineSwitch, MonthField, Segmented, Select, ToggleRow } from "../../../components/form";
import { Card, Divider, Screen } from "../../../components/ui";
import { money } from "../../../lib/format";
import { usePlan } from "../../../lib/plan";
import { isCard } from "../../../lib/register";
import { monthKey, newId, useStore } from "../../../lib/store";
import { space, type, useTheme } from "../../../lib/theme";
import { buildImport, categoryKey, exportMonths, groupKey, parseYnab, readYnabZip, recentMonths, suggestCategory, suggestChoice, ynabAccounts, ynabCategories, type AccountChoice, type CategoryChoice, type YnabAccount, type YnabData } from "../../../lib/ynab";
import { sticky, stickyBottom } from "../../../lib/sticky";
import { useLayout } from "../../../lib/layout";
import { groupOrder } from "../../../lib/budgetOrder";
import { ImportUndoCard } from "../../../components/ImportUndo";

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
const KIND_LABEL = { cash: "Checking or savings", card: "Credit card", invest: "Investment (tracking)", loan: "Loan (tracking)" } as const;
const KIND_ORDER = ["cash", "card", "invest", "loan"] as const;
const KIND_SECTION = { cash: "Checking & savings", card: "Credit cards", invest: "Investments", loan: "Loans" } as const;

/** Read the picked file: YNAB's zip, or its Register CSV (with its Plan CSV if picked too). */
async function readFiles(files: FileList): Promise<YnabData> {
  const list = [...files];
  const zip = list.find((f) => /\.zip$/i.test(f.name));
  if (zip) {
    const { register, plan } = readYnabZip(new Uint8Array(await zip.arrayBuffer()));
    return parseYnab(register, plan);
  }
  const reg = list.find((f) => /register/i.test(f.name)) ?? list.find((f) => /\.csv$/i.test(f.name));
  if (!reg) throw new Error("Pick the zip YNAB exports (or its Register CSV).");
  const plan = list.find((f) => f !== reg && /(plan|budget)\.csv$/i.test(f.name));
  return parseYnab(await reg.text(), plan ? await plan.text() : undefined);
}

/** `setup`: opened from setup (before there's a budget); it goes back to setup when done. */
export default function ImportYnab({ setup }: { setup?: boolean } = {}) {
  const t = useTheme();
  const router = useRouter();
  const { state, start } = usePlan();
  const saved = useStore((s) => s.plan);
  const importBudget = useStore((s) => s.importBudget);
  const importedAt = useStore((s) => s.importedAt);
  const [undone, setUndone] = useState(false);
  const backToSetup = () => router.replace("/onboarding?step=money");
  const existing = useStore((s) => s.txns);
  const thisMonth = monthKey(start);
  const [data, setData] = useState<YnabData | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [doneNeeds, setDoneNeeds] = useState(0);
  // the first month to bring in ("all" = everything); default: the last 3
  const [range, setRange] = useState<string>("");
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [choices, setChoices] = useState<Record<string, AccountChoice>>({});
  const [catOpts, setCatOpts] = useState<Record<string, { inRetirement: boolean; essential: boolean }>>({});
  const [removeEmpty, setRemoveEmpty] = useState(true);
  const [catMap, setCatMap] = useState<Record<string, CategoryChoice>>({});
  const [keepBoth, setKeepBoth] = useState<string[]>([]);
  // which of your groups each YNAB group's categories land in
  const [groupMap, setGroupMap] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"accounts" | "categories" | "matches">("accounts");
  const [showQuiet, setShowQuiet] = useState(false);
  const [showUnused, setShowUnused] = useState(false);
  // the confirmation shows on the page (a browser pop-up can be blocked, as in an embedded browser)
  const [confirming, setConfirming] = useState(false);
  // the pinned tabs' height, so the categories' column labels stick just under them
  const [tabsH, setTabsH] = useState(44);
  const { contentWidth } = useLayout();
  const wide = Platform.OS === "web" && contentWidth >= 960;

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
        const d = await readFiles(input.files!);
        if (!d.txns.length) throw new Error("No transactions in that file.");
        setData(d);
        setFileName([...input.files!].find((x) => /\.zip$/i.test(x.name))?.name ?? input.files![0]?.name ?? "");
        const since = recentMonths(thisMonth, 2)[0]!;
        // closed or empty accounts start left out; the open ones match an account here with the same name (each only once)
        const taken = new Set<string>();
        setChoices(Object.fromEntries(ynabAccounts(d).map((a) => {
          if (quietAccount(d, a.name, a.balance, since)) return [a.name, { action: "skip" }];
          const sug = suggestChoice(state, a, taken);
          if (sug.action === "match") taken.add(sug.id);
          return [a.name, sug];
        })));
        setCatMap(Object.fromEntries(ynabCategories(d, recentMonths(thisMonth)).map((c) => {
          const sug = suggestCategory(state, c);
          return [categoryKey(c.group, c.name), sug.action === "new" && unusedCategory(d, c, since) ? { action: "skip" } : sug];
        })));
        setTab("accounts");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    };
    input.click();
  };

  const accounts = useMemo(() => (data ? ynabAccounts(data) : []), [data]);
  const categories = useMemo(() => (data ? ynabCategories(data, recentMonths(thisMonth)) : []), [data, thisMonth]);
  const months = useMemo(() => (data ? exportMonths(data, thisMonth) : []), [data, thisMonth]);
  // default: the last 3 months, or all the export has if that is less
  const startPick = range || (months.includes(recentMonths(thisMonth, 2)[0]!) ? recentMonths(thisMonth, 2)[0]! : "all");
  const from = startPick === "all" ? null : startPick;
  const oldest = months[months.length - 1];
  const startMonth = from ?? oldest ?? thisMonth;
  const monthCount = months.indexOf(startMonth) + 1;
  const opts = (k: string) => catOpts[k] ?? { inRetirement: true, essential: true };
  const preview = useMemo(
    () => (data ? buildImport(saved, data, { from, thisMonth, accounts: choices, categories: catOpts, categoryMap: catMap, groupMap, amounts, removeEmpty, existing, keepBoth, newId: () => "preview" }) : null),
    [data, saved, from, thisMonth, choices, catOpts, catMap, groupMap, amounts, removeEmpty, existing, keepBoth],
  );

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

  const run = () => {
    if (!data) return;
    setConfirming(false);
    const r = buildImport(saved, data, { from, thisMonth, accounts: choices, categories: catOpts, categoryMap: catMap, groupMap, amounts, removeEmpty, existing, keepBoth, newId });
    importBudget(r.plan, r.txns, r.replaced);
    setDone(`Imported ${r.summary.transactions} transactions and ${r.summary.categoriesAdded + r.summary.categoriesUpdated} categories.`);
    setDoneNeeds(r.summary.needsCategoryFromYnab + r.summary.needsCategoryLeftOut);
    setData(null);
  };

  const since = from;
  const quietAccounts = data ? accounts.filter((a) => quietAccount(data, a.name, a.balance, since)) : [];
  const activeAccounts = accounts.filter((a) => !quietAccounts.includes(a));
  const unusedCats = data ? categories.filter((c) => unusedCategory(data, c, since)) : [];
  const activeCats = categories.filter((c) => !unusedCats.includes(c));
  const accountRow = (a: YnabAccount, i: number) => (
    <View key={a.name} style={{ gap: 4 }}>
      {i > 0 ? <Divider /> : null}
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.body, { color: choices[a.name]?.action === "skip" ? t.text3 : t.text, fontWeight: "600" }]} numberOfLines={1}>{a.name}</Text>
          <Text style={[type.caption, { color: t.text3 }]}>{KIND_LABEL[a.kind]} · {a.kind === "card" || a.kind === "loan" ? `owe ${money(Math.max(0, -a.balance))}` : money(a.balance)}</Text>
        </View>
        <Select label={`${a.name}: what it is here`} value={valueOf(choices[a.name])} options={options(a)} onChange={(v) => setChoice(a.name, v)} />
      </View>
    </View>
  );
  const acctName = (id: string) => saved.accounts.find((a) => a.id === id)?.name ?? saved.debts.find((d) => d.id === id)?.name ?? "Account";
  const catName = (id?: string) => (!id ? "No category" : id === "ready" ? "Unassigned" : id === "cash" ? "Emergency fund" : saved.budget.find((b) => b.id === id)?.name ?? preview?.plan.budget.find((b) => b.id === id)?.name ?? "Category");
  const day = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const mine = saved.budget.filter((b) => !b.accountId);
  const catOptions = [
    { value: "new", label: "Add as a new category" },
    ...mine.map((b) => ({ value: "match:" + b.id, label: `Into ${b.name || "category"}`, hint: b.group })),
    { value: "match:cash", label: "Into Emergency fund" },
    { value: "skip", label: "Leave it out" },
  ];
  const yourGroups = groupOrder(saved.budget).filter((g) => !!g);
  const sameGroup = (g: string) => yourGroups.find((x) => x.trim().toLowerCase() === g.trim().toLowerCase());
  const groupTarget = (g: string) => groupMap[groupKey(g)] ?? sameGroup(g) ?? g;
  const groupOptions = (g: string) => [
    ...(sameGroup(g) ? [] : [{ value: g, label: `${g} (new group)` }]),
    ...yourGroups.map((x) => ({ value: x, label: x })),
  ];
  const catValue = (c: CategoryChoice | undefined) => (!c ? "new" : c.action === "match" ? "match:" + c.id : c.action);
  const setCat = (k: string, v: string) => setCatMap((m) => ({ ...m, [k]: v.startsWith("match:") ? { action: "match", id: v.slice(6) } : { action: v as "new" | "skip" } }));
  const categoryRow = (c: (typeof categories)[number]) => {
    const k = categoryKey(c.group, c.name);
    const o = opts(k);
    const ch = catMap[k];
    // left out, or into the Emergency fund: it isn't spending, so the switches don't apply
    const spending = !ch || ch.action === "new" || (ch.action === "match" && ch.id !== "cash");
    const perMonth = ch?.action !== "skip" ? (
      <View style={[styles.row, { gap: 4 }, wide ? { width: 190 } : null, wide ? { justifyContent: "flex-end" } : null]}>
        <InlineMoney label={`${c.name}: a month`} value={amounts[k] ?? c.average} onChange={(v) => setAmounts((m) => ({ ...m, [k]: v }))} />
        <Text style={[type.caption, { color: t.text3 }]}>/mo</Text>
      </View>
    ) : null;
    return (
      <View key={k} style={[styles.catRow, { borderTopColor: t.border }]}>
        <View style={styles.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.body, { color: ch?.action === "skip" ? t.text3 : t.text, fontWeight: "600" }]} numberOfLines={1}>{c.name}</Text>
            {amounts[k] !== undefined && Math.abs(amounts[k]! - c.average) > 0.5 ? (
              <Pressable onPress={() => setAmounts(({ [k]: _, ...m }) => m)} hitSlop={6} style={{ alignSelf: "flex-start" }}>
                <Text style={[type.caption, { color: t.accent }]}>Reset to YNAB's {money(c.average, { whole: true })}</Text>
              </Pressable>
            ) : null}
          </View>
          {wide ? perMonth : null}
          {wide ? (
            <View style={{ width: 220 }}>
              <Select plain label={`${c.name}: where it goes`} value={catValue(ch)} options={catOptions} onChange={(v) => setCat(k, v)} />
            </View>
          ) : null}
          {spending ? (
            <>
              <View style={styles.col}><InlineSwitch label={`${c.name}: still paid after retiring`} value={o.inRetirement} onChange={(v) => setCatOpts((s2) => ({ ...s2, [k]: { ...o, inRetirement: v } }))} /></View>
              <View style={styles.col}><InlineSwitch label={`${c.name}: essential`} value={o.essential} onChange={(v) => setCatOpts((s2) => ({ ...s2, [k]: { ...o, essential: v } }))} /></View>
            </>
          ) : (
            <Text style={[type.caption, { color: t.text3, width: 84 * 2 + space.sm, textAlign: "center" }]}>{ch?.action === "skip" ? "Not brought in" : "Savings, not spending"}</Text>
          )}
        </View>
        {!wide ? (
          <View style={{ gap: 4, alignItems: "flex-start" }}>
            {perMonth}
            <Select plain label={`${c.name}: where it goes`} value={catValue(ch)} options={catOptions} onChange={(v) => setCat(k, v)} />
          </View>
        ) : null}
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
  const importedCard = importedAt && !data ? (
    <ImportUndoCard onUndone={() => { setDone(""); setUndone(true); }}>
      {doneNote}
      {setup && !done ? <Button title="Continue setup" tone="primary" onPress={backToSetup} style={{ alignSelf: "flex-start" }} /> : null}
    </ImportUndoCard>
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
      {doneNote}
    </Card>
  ));
  const review = data && preview ? (
    <>
          <View onLayout={(e) => setTabsH(Math.round(e.nativeEvent.layout.height))} style={[styles.pinned, sticky(0, t.bg)]}>
          <Segmented
            label="What to review"
            options={[
              { value: "accounts", label: `Accounts (${activeAccounts.length})` },
              { value: "categories", label: `Categories (${activeCats.length})` },
              ...(preview.matches.length ? [{ value: "matches" as const, label: `Matches (${preview.matches.length})` }] : []),
            ]}
            value={tab}
            onChange={setTab}
          />
          </View>

          {tab === "accounts" ? (
            <Card style={{ gap: space.sm }}>
              <Text style={[type.caption, { color: t.text3 }]}>
                What each of your YNAB accounts is here: the same as one you have, a new one, or left out.
              </Text>
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
              {quietAccounts.length ? (
                <>
                  <Divider />
                  <Pressable role="button" aria-expanded={showQuiet} onPress={() => setShowQuiet((v) => !v)} hitSlop={6}>
                    <Text style={[type.label, { color: t.accent, fontWeight: "700" }]}>
                      {showQuiet ? "Hide" : "Show"} {quietAccounts.length} closed or empty {quietAccounts.length === 1 ? "account" : "accounts"} (left out)
                    </Text>
                  </Pressable>
                  {showQuiet ? quietAccounts.map((a, i) => accountRow(a, i)) : null}
                </>
              ) : null}
            </Card>
          ) : null}

          {tab === "categories" ? (
            <Card style={{ gap: space.sm }}>
              <Text style={[type.caption, { color: t.text3 }]}>
                Each comes in with what you assigned a month lately. Pick where each one goes, and which of your groups each YNAB group lands in. Turn off After retiring for what you won't pay then, and Essential for what you'd cut in an emergency.
              </Text>
              <View style={[styles.row, { paddingVertical: space.xs }, sticky(tabsH, t.surface)]}>
                <Text style={[type.caption, { color: t.text3, flex: 1 }]}>Category</Text>
                {wide ? <Text style={[type.caption, { color: t.text3, width: 190, textAlign: "right", paddingRight: 28 }]}>A month</Text> : null}
                {wide ? <Text style={[type.caption, { color: t.text3, width: 220, textAlign: "right", paddingRight: 18 }]}>Goes to</Text> : null}
                <Text style={[type.caption, styles.col, { color: t.text3 }]}>After retiring</Text>
                <Text style={[type.caption, styles.col, { color: t.text3 }]}>Essential</Text>
              </View>
              {[...new Set(activeCats.map((c) => c.group))].map((g) => (
                <View key={g} style={[styles.group, { borderColor: t.border, backgroundColor: t.surface2 }]}>
                  <View style={[styles.row, { flexWrap: "wrap", justifyContent: "space-between", paddingBottom: space.sm }]}>
                    <View style={[styles.row, { flexShrink: 1, gap: space.sm }]}>
                      <View style={[styles.groupDot, { backgroundColor: t.accent }]} />
                      <Text style={[type.heading, { color: t.text, flexShrink: 1 }]} numberOfLines={1}>{g || "No group"}</Text>
                      <View style={[styles.pill, { backgroundColor: t.surface }]}>
                        <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]}>{activeCats.filter((c) => c.group === g).length}</Text>
                      </View>
                    </View>
                    {g ? (
                      <View style={[styles.row, { flexShrink: 1 }]}>
                        <Text style={[type.caption, { color: t.text3 }]}>Into your group</Text>
                        <Select label={`${g}: lands in group`} value={groupTarget(g)} options={groupOptions(g)} onChange={(v) => setGroupMap((m) => ({ ...m, [groupKey(g)]: v }))} />
                      </View>
                    ) : null}
                  </View>
                  {activeCats.filter((c) => c.group === g).map(categoryRow)}
                </View>
              ))}
              {unusedCats.length ? (
                <>
                  <Divider />
                  <Pressable role="button" aria-expanded={showUnused} onPress={() => setShowUnused((v) => !v)} hitSlop={6}>
                    <Text style={[type.label, { color: t.accent, fontWeight: "700" }]}>
                      {showUnused ? "Hide" : "Show"} {unusedCats.length} {unusedCats.length === 1 ? "category" : "categories"} you haven't used lately (left out)
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
    { n: preview.summary.categoriesAdded + preview.summary.categoriesUpdated, label: "Categories", sub: `${preview.summary.categoriesAdded} new · ${preview.summary.categoriesUpdated} matched${preview.summary.categoriesSkipped ? ` · ${preview.summary.categoriesSkipped} left out` : ""}` },
    { n: preview.summary.accountsAdded, label: "New accounts", sub: "the rest matched or left out" },
    { n: preview.summary.months, label: preview.summary.months === 1 ? "Month assigned" : "Months assigned", sub: "what you gave each category" },
  ] : [];
  const notes = preview ? (
    <>
      {preview.summary.needsCategoryFromYnab + preview.summary.needsCategoryLeftOut ? (
        <Text style={[type.caption, { color: t.warn }]}>
          {preview.summary.needsCategoryFromYnab + preview.summary.needsCategoryLeftOut} transactions will need a category
          {preview.summary.needsCategoryFromYnab && preview.summary.needsCategoryLeftOut
            ? ` (${preview.summary.needsCategoryFromYnab} had none in YNAB, ${preview.summary.needsCategoryLeftOut} are in categories you left out)`
            : preview.summary.needsCategoryLeftOut ? " (they're in categories you left out)" : " (they had none in YNAB)"}
          . You'll find them under Transactions.
        </Text>
      ) : null}
      {preview.summary.categoriesRemoved ? (
        <Text style={[type.caption, { color: t.text2 }]}>
          {preview.summary.categoriesRemoved} empty starter {preview.summary.categoriesRemoved === 1 ? "category" : "categories"} YNAB doesn't have will be removed.
        </Text>
      ) : null}
      <Text style={[type.caption, { color: t.text3 }]}>{setup ? "You can undo the import for 30 days." : "Your other transactions stay. You can undo the import for 30 days."}</Text>
    </>
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
      <View style={styles.stats}>
        {stats.map((x) => (
          <View key={x.label} style={[styles.stat, { backgroundColor: t.surface2 }]}>
            <Text style={[type.title, { color: t.text, fontVariant: ["tabular-nums"] }]}>{x.n}</Text>
            <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>{x.label}</Text>
            <Text style={[type.caption, { color: t.text3 }]}>{x.sub}</Text>
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
            {preview.summary.needsCategoryFromYnab + preview.summary.needsCategoryLeftOut ? <Text style={{ color: t.warn }}> · {preview.summary.needsCategoryFromYnab + preview.summary.needsCategoryLeftOut} need a category</Text> : null}
          </Text>
          {actions}
        </>
      )}
    </View>
  ) : null;
  const trademark = <Text style={[type.caption, { color: t.text3 }]}>Coastline isn't affiliated with YNAB. YNAB is a trademark of its owner.</Text>;

  return (
    <Screen title="Import from YNAB" back={setup ? backToSetup : () => router.navigate("/budget")} hideSettings={setup} narrow={!(wide && loaded)}>
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
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  note: { borderWidth: 1, borderRadius: 10, padding: space.md, gap: space.sm },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: space.md, paddingVertical: space.sm, marginTop: space.xs },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: space.lg },
  side: { width: 360, gap: space.lg },
  pinned: { paddingVertical: space.xs, marginVertical: -space.xs },
  bottomBar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, borderWidth: 1, borderRadius: 12, paddingHorizontal: space.md, paddingVertical: space.sm },
  stat: { flexGrow: 1, flexBasis: 140, borderRadius: 10, padding: space.md, gap: 2 },
  statSmall: { flexGrow: 1, flexBasis: 130, borderRadius: 10, paddingHorizontal: space.md, paddingVertical: space.sm, gap: 1 },
});
