/**
 * Import from YNAB: pick its export, then choose which months to bring in, what each of its
 * accounts is here (match, add or skip), and which categories you'd still pay after retiring and
 * which are essential. Nothing changes until you press Import.
 */
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Button, InlineSwitch, Segmented, Select, ToggleRow } from "../../../components/form";
import { Card, Divider, Screen } from "../../../components/ui";
import { confirm } from "../../../lib/confirm";
import { money } from "../../../lib/format";
import { usePlan } from "../../../lib/plan";
import { isCard } from "../../../lib/register";
import { monthKey, newId, useStore } from "../../../lib/store";
import { space, type, useTheme } from "../../../lib/theme";
import { buildImport, categoryKey, parseYnab, readYnabZip, recentMonths, suggestCategory, suggestChoice, ynabAccounts, ynabCategories, type AccountChoice, type CategoryChoice, type YnabAccount, type YnabData } from "../../../lib/ynab";

type Range = "3" | "12" | "all";
const KIND_LABEL = { cash: "Checking or savings", card: "Credit card", invest: "Investment (tracking)", loan: "Loan (tracking)" } as const;

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

export default function ImportYnab() {
  const t = useTheme();
  const router = useRouter();
  const { state, start } = usePlan();
  const saved = useStore((s) => s.plan);
  const importBudget = useStore((s) => s.importBudget);
  const existing = useStore((s) => s.txns);
  const thisMonth = monthKey(start);
  const [data, setData] = useState<YnabData | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [range, setRange] = useState<Range>("3");
  const [choices, setChoices] = useState<Record<string, AccountChoice>>({});
  const [catOpts, setCatOpts] = useState<Record<string, { inRetirement: boolean; essential: boolean }>>({});
  const [removeEmpty, setRemoveEmpty] = useState(true);
  const [catMap, setCatMap] = useState<Record<string, CategoryChoice>>({});
  const [keepBoth, setKeepBoth] = useState<string[]>([]);

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
        setChoices(Object.fromEntries(ynabAccounts(d).map((a) => [a.name, suggestChoice(state, a)])));
        setCatMap(Object.fromEntries(ynabCategories(d, recentMonths(thisMonth)).map((c) => [categoryKey(c.group, c.name), suggestCategory(state, c)])));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    };
    input.click();
  };

  const accounts = useMemo(() => (data ? ynabAccounts(data) : []), [data]);
  const categories = useMemo(() => (data ? ynabCategories(data, recentMonths(thisMonth)) : []), [data, thisMonth]);
  const from = range === "all" ? null : recentMonths(thisMonth, range === "3" ? 2 : 11)[0]!;
  const opts = (k: string) => catOpts[k] ?? { inRetirement: true, essential: true };
  const preview = useMemo(
    () => (data ? buildImport(saved, data, { from, thisMonth, accounts: choices, categories: catOpts, categoryMap: catMap, removeEmpty, existing, keepBoth, newId: () => "preview" }) : null),
    [data, saved, from, thisMonth, choices, catOpts, catMap, removeEmpty, existing, keepBoth],
  );

  const options = (a: YnabAccount) => {
    const pool =
      a.kind === "cash" ? state.accounts.filter((x) => x.type === "cash")
      : a.kind === "card" ? state.debts.filter(isCard)
      : a.kind === "loan" ? state.debts.filter((x) => !isCard(x))
      : state.accounts.filter((x) => x.type !== "cash");
    return [
      ...pool.map((x) => ({ value: "match:" + x.id, label: `Same as ${x.name || "account"}` })),
      { value: "add", label: "Add as a new account" },
      { value: "skip", label: "Leave it out" },
    ];
  };
  const valueOf = (c: AccountChoice | undefined) => (!c ? "add" : c.action === "match" ? "match:" + c.id : c.action);
  const setChoice = (name: string, v: string) => setChoices((s) => ({ ...s, [name]: v.startsWith("match:") ? { action: "match", id: v.slice(6) } : { action: v as "add" | "skip" } }));

  const run = async () => {
    if (!data) return;
    const sum = preview!.summary;
    const ok = await confirm(
      "Import from YNAB?",
      `${sum.transactions} transactions${sum.transactionsMatched ? ` (replacing ${sum.transactionsMatched} of yours)` : ""}, ${sum.categoriesAdded} new and ${sum.categoriesUpdated} matched categories, ${sum.accountsAdded} new accounts. Importing again later replaces what came in this time.`,
      "Import",
    );
    if (!ok) return;
    const r = buildImport(saved, data, { from, thisMonth, accounts: choices, categories: catOpts, categoryMap: catMap, removeEmpty, existing, keepBoth, newId });
    importBudget(r.plan, r.txns, r.replaced);
    setDone(`Imported ${r.summary.transactions} transactions and ${r.summary.categoriesAdded + r.summary.categoriesUpdated} categories.`);
    setData(null);
  };

  const groups = [...new Set(categories.map((c) => c.group))];
  const acctName = (id: string) => saved.accounts.find((a) => a.id === id)?.name ?? saved.debts.find((d) => d.id === id)?.name ?? "Account";
  const catName = (id?: string) => (!id ? "No category" : id === "ready" ? "Ready to assign" : id === "cash" ? "Emergency fund" : saved.budget.find((b) => b.id === id)?.name ?? preview?.plan.budget.find((b) => b.id === id)?.name ?? "Category");
  const day = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const mine = saved.budget.filter((b) => !b.accountId);
  const catOptions = [
    { value: "new", label: "Add as a new category" },
    ...mine.map((b) => ({ value: "match:" + b.id, label: `Into ${b.name || "category"}`, hint: b.group })),
    { value: "match:cash", label: "Into Emergency fund" },
    { value: "skip", label: "Leave it out" },
  ];
  const catValue = (c: CategoryChoice | undefined) => (!c ? "new" : c.action === "match" ? "match:" + c.id : c.action);
  const setCat = (k: string, v: string) => setCatMap((m) => ({ ...m, [k]: v.startsWith("match:") ? { action: "match", id: v.slice(6) } : { action: v as "new" | "skip" } }));
  return (
    <Screen title="Import from YNAB" back={() => router.navigate("/budget")} narrow>
      <Card style={{ gap: space.sm }}>
        <Text style={[type.body, { color: t.text2 }]}>
          In YNAB, open your budget's menu and choose Export budget. It downloads a zip; pick it here. You'll choose what comes in before anything changes.
        </Text>
        {Platform.OS === "web" ? (
          <Button title={data ? "Pick a different file" : "Choose YNAB export"} tone={data ? "ghost" : "primary"} icon="plus" onPress={pick} style={{ alignSelf: "flex-start" }} />
        ) : (
          <Text style={[type.caption, { color: t.text3 }]}>Importing works in the web app for now.</Text>
        )}
        {error ? <Text role="alert" style={[type.label, { color: t.bad }]}>{error}</Text> : null}
        {done ? (
          <View style={{ gap: space.sm }}>
            <Text role="status" style={[type.label, { color: t.good }]}>{done}</Text>
            <Button title="Go to Budget" tone="primary" onPress={() => router.navigate("/budget")} style={{ alignSelf: "flex-start" }} />
          </View>
        ) : null}
      </Card>

      {data && preview ? (
        <>
          <Card style={{ gap: space.sm }}>
            <Text style={[type.heading, { color: t.text }]}>Which months</Text>
            <Segmented label="Months to bring in" options={[{ value: "3", label: "Last 3 months" }, { value: "12", label: "Last 12 months" }, { value: "all", label: "Everything" }]} value={range} onChange={setRange} />
            <Text style={[type.caption, { color: t.text3 }]}>
              Each account starts with its balance on the first day{from ? ` (${from})` : ""}; transactions and what you assigned come in from then on.
            </Text>
          </Card>

          <Card style={{ gap: space.sm }}>
            <Text style={[type.heading, { color: t.text }]}>Accounts</Text>
            {accounts.map((a, i) => (
              <View key={a.name} style={{ gap: 4 }}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.body, { color: t.text, fontWeight: "600" }]} numberOfLines={1}>{a.name}</Text>
                    <Text style={[type.caption, { color: t.text3 }]}>{KIND_LABEL[a.kind]} · {a.kind === "card" || a.kind === "loan" ? `owe ${money(Math.max(0, -a.balance))}` : money(a.balance)}</Text>
                  </View>
                  <Select label={`${a.name}: what it is here`} value={valueOf(choices[a.name])} options={options(a)} onChange={(v) => setChoice(a.name, v)} />
                </View>
              </View>
            ))}
            <Text style={[type.caption, { color: t.text3 }]}>Tracking accounts (investments, loans) bring their balance, not their transactions.</Text>
          </Card>

          <Card style={{ gap: space.sm }}>
            <Text style={[type.heading, { color: t.text }]}>Categories</Text>
            <Text style={[type.caption, { color: t.text3 }]}>
              Each comes in with what you assigned a month lately: as a new category, into one of yours, or not at all. Turn off After retiring for what you won't pay then (daycare, a car payment), and Essential for what you'd cut in a money emergency.
            </Text>
            <View style={styles.row}>
              <Text style={[type.caption, { color: t.text3, flex: 1 }]} />
              <Text style={[type.caption, styles.col, { color: t.text3 }]}>After retiring</Text>
              <Text style={[type.caption, styles.col, { color: t.text3 }]}>Essential</Text>
            </View>
            {groups.map((g) => (
              <View key={g} style={{ gap: 2 }}>
                <Text style={[type.overline, { color: t.text2, marginTop: space.xs }]}>{g || "No group"}</Text>
                {categories.filter((c) => c.group === g).map((c) => {
                  const k = categoryKey(c.group, c.name);
                  const o = opts(k);
                  const ch = catMap[k];
                  // left out, or into the Emergency fund: it isn't spending, so the switches don't apply
                  const spending = !ch || ch.action === "new" || (ch.action === "match" && ch.id !== "cash");
                  return (
                    <View key={k} style={[styles.catRow, { borderTopColor: t.border }]}>
                      <View style={styles.row}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[type.body, { color: ch?.action === "skip" ? t.text3 : t.text }]} numberOfLines={1}>{c.name}</Text>
                          <Text style={[type.caption, { color: t.text3 }]}>{money(c.average, { whole: true })}/mo</Text>
                        </View>
                        {spending ? (
                          <>
                            <View style={styles.col}><InlineSwitch label={`${c.name}: still paid after retiring`} value={o.inRetirement} onChange={(v) => setCatOpts((s) => ({ ...s, [k]: { ...o, inRetirement: v } }))} /></View>
                            <View style={styles.col}><InlineSwitch label={`${c.name}: essential`} value={o.essential} onChange={(v) => setCatOpts((s) => ({ ...s, [k]: { ...o, essential: v } }))} /></View>
                          </>
                        ) : (
                          <Text style={[type.caption, { color: t.text3, width: 84 * 2 + space.sm, textAlign: "center" }]}>{ch?.action === "skip" ? "Not brought in" : "Savings, not spending"}</Text>
                        )}
                      </View>
                      <View style={{ alignSelf: "flex-start" }}>
                        <Select plain label={`${c.name}: where it goes`} value={catValue(ch)} options={catOptions} onChange={(v) => setCat(k, v)} />
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
            <Divider />
            <ToggleRow label="Remove my $0 categories YNAB doesn't have" hint="The starter categories you never filled in" value={removeEmpty} onChange={setRemoveEmpty} />
          </Card>

          {preview.matches.length ? (
            <Card style={{ gap: space.sm }}>
              <Text style={[type.heading, { color: t.text }]}>Transactions you already have</Text>
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

          <Card style={{ gap: space.md }}>
            <Text style={[type.heading, { color: t.text }]}>What comes in</Text>
            <View style={styles.stats}>
              {[
                { n: preview.summary.transactions, label: "Transactions", sub: preview.summary.transactionsMatched ? `replacing ${preview.summary.transactionsMatched} of yours` : "with starting balances" },
                { n: preview.summary.categoriesAdded + preview.summary.categoriesUpdated, label: "Categories", sub: `${preview.summary.categoriesAdded} new · ${preview.summary.categoriesUpdated} matched${preview.summary.categoriesSkipped ? ` · ${preview.summary.categoriesSkipped} left out` : ""}` },
                { n: preview.summary.accountsAdded, label: "New accounts", sub: "the rest are matched or left out" },
                { n: preview.summary.months, label: preview.summary.months === 1 ? "Month assigned" : "Months assigned", sub: "what you gave each category" },
              ].map((s) => (
                <View key={s.label} style={[styles.stat, { backgroundColor: t.surface2 }]}>
                  <Text style={[type.title, { color: t.text, fontVariant: ["tabular-nums"] }]}>{s.n}</Text>
                  <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>{s.label}</Text>
                  <Text style={[type.caption, { color: t.text3 }]}>{s.sub}</Text>
                </View>
              ))}
            </View>
            {preview.summary.categoriesRemoved ? (
              <Text style={[type.caption, { color: t.text2 }]}>
                {preview.summary.categoriesRemoved} empty starter {preview.summary.categoriesRemoved === 1 ? "category" : "categories"} YNAB doesn't have will be removed.
              </Text>
            ) : null}
            <Text style={[type.caption, { color: t.text3 }]}>Your other transactions stay. Importing again later replaces what came in this time.</Text>
            <Button title="Import" tone="primary" onPress={run} style={{ alignSelf: "flex-start", minHeight: 44 }} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  col: { width: 84, alignItems: "center", textAlign: "center" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  catRow: { gap: 2, paddingVertical: space.xs, borderTopWidth: StyleSheet.hairlineWidth },
  stat: { flexGrow: 1, flexBasis: 140, borderRadius: 10, padding: space.md, gap: 2 },
});
