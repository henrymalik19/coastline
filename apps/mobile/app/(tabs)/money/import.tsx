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
import { buildImport, categoryKey, parseYnab, readYnabZip, recentMonths, suggestChoice, ynabAccounts, ynabCategories, type AccountChoice, type YnabAccount, type YnabData } from "../../../lib/ynab";

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
  const thisMonth = monthKey(start);
  const [data, setData] = useState<YnabData | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [range, setRange] = useState<Range>("3");
  const [choices, setChoices] = useState<Record<string, AccountChoice>>({});
  const [catOpts, setCatOpts] = useState<Record<string, { inRetirement: boolean; essential: boolean }>>({});
  const [removeEmpty, setRemoveEmpty] = useState(true);

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
    () => (data ? buildImport(saved, data, { from, thisMonth, accounts: choices, categories: catOpts, removeEmpty, newId: () => "preview" }) : null),
    [data, saved, from, thisMonth, choices, catOpts, removeEmpty],
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
      `${sum.transactions} transactions, ${sum.categoriesAdded} new and ${sum.categoriesUpdated} matched categories, ${sum.accountsAdded} new accounts. Importing again later replaces what came in this time.`,
      "Import",
    );
    if (!ok) return;
    const r = buildImport(saved, data, { from, thisMonth, accounts: choices, categories: catOpts, removeEmpty, newId });
    importBudget(r.plan, r.txns);
    setDone(`Imported ${r.summary.transactions} transactions and ${r.summary.categoriesAdded + r.summary.categoriesUpdated} categories.`);
    setData(null);
  };

  const groups = [...new Set(categories.map((c) => c.group))];
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
              Each comes in with what you assigned a month lately. Turn off After retiring for what you won't pay then (daycare, a car payment), and Essential for what you'd cut in a money emergency.
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
                  return (
                    <View key={k} style={styles.row}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{c.name}</Text>
                        <Text style={[type.caption, { color: t.text3 }]}>{money(c.average, { whole: true })}/mo</Text>
                      </View>
                      <View style={styles.col}><InlineSwitch label={`${c.name}: still paid after retiring`} value={o.inRetirement} onChange={(v) => setCatOpts((s) => ({ ...s, [k]: { ...o, inRetirement: v } }))} /></View>
                      <View style={styles.col}><InlineSwitch label={`${c.name}: essential`} value={o.essential} onChange={(v) => setCatOpts((s) => ({ ...s, [k]: { ...o, essential: v } }))} /></View>
                    </View>
                  );
                })}
              </View>
            ))}
            <Divider />
            <ToggleRow label="Remove my $0 categories YNAB doesn't have" hint="The starter categories you never filled in" value={removeEmpty} onChange={setRemoveEmpty} />
          </Card>

          <Card style={{ gap: space.md }}>
            <Text style={[type.heading, { color: t.text }]}>What comes in</Text>
            <View style={styles.stats}>
              {[
                { n: preview.summary.transactions, label: "Transactions", sub: "with starting balances" },
                { n: preview.summary.categoriesAdded + preview.summary.categoriesUpdated, label: "Categories", sub: `${preview.summary.categoriesAdded} new · ${preview.summary.categoriesUpdated} matched` },
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
            <Text style={[type.caption, { color: t.text3 }]}>Transactions you added here yourself stay. Importing again later replaces what came in this time.</Text>
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
  stat: { flexGrow: 1, flexBasis: 140, borderRadius: 10, padding: space.md, gap: 2 },
});
