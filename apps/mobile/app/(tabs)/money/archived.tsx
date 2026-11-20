/**
 * Sort archived categories: every archived category that's on its own, on one page, each with where its
 * money went. Pick the current category it belongs under (the ones whose transactions went to the same
 * places are picked for you) and file them all at once. Each stays archived with its own name; its
 * history counts in the category it's under.
 */
import type { BudgetItem } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Select } from "../../../components/form";
import { Card, Divider, Screen } from "../../../components/ui";
import { CLOSED_ACCOUNTS_GROUP, groupOf } from "../../../lib/budgetOrder";
import { confirm } from "../../../lib/confirm";
import { foldSuggestions } from "../../../lib/foldSuggest";
import { usePlan } from "../../../lib/plan";
import { useStore } from "../../../lib/store";
import { parentChoices } from "../../../lib/subcats";
import { space, type, useTheme } from "../../../lib/theme";

type Info = { count: number; first?: string; last?: string; payees: string[]; by: Map<string, number> };
const year = (d?: string) => (d ? d.slice(0, 4) : "");
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export default function SortArchived() {
  const t = useTheme();
  const router = useRouter();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const txns = useStore((s) => s.txns);
  const budget = state.budget;
  const folds = useMemo(() => foldSuggestions(budget, txns), [budget, txns]);
  const suggested = useMemo(() => new Map(folds.map((f) => [f.id, f.under])), [folds]);
  const name = (id?: string) => budget.find((b) => b.id === id)?.name || "A category";

  // archived ones on their own (not the payment lines of closed accounts), and the ones already filed
  const loose = budget.filter((b) => b.hidden && !b.parentId && b.group !== CLOSED_ACCOUNTS_GROUP);
  const filed = budget.filter((b) => b.hidden && b.parentId && budget.some((p) => p.id === b.parentId && !p.hidden));

  // how many transactions each has, the years, and the places it was spent most
  const info = useMemo(() => {
    const m = new Map<string, Info>();
    const add = (id: string | undefined, date: string, payee?: string) => {
      if (!id) return;
      const x: Info = m.get(id) ?? { count: 0, payees: [], by: new Map() };
      x.count++;
      if (!x.first || date < x.first) x.first = date;
      if (!x.last || date > x.last) x.last = date;
      if (payee) x.by.set(payee, (x.by.get(payee) ?? 0) + 1);
      m.set(id, x);
    };
    for (const tx of txns) {
      if (tx.deleted) continue;
      if (tx.splits?.length) for (const s of tx.splits) add(s.categoryId, tx.date, tx.payee);
      else add(tx.categoryId, tx.date, tx.payee);
    }
    for (const x of m.values()) x.payees = [...x.by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p);
    return m;
  }, [txns]);

  // what you've picked for each ("" = leave it on its own); a suggestion is picked until you change it
  const [picks, setPicks] = useState<Record<string, string>>({});
  const pickOf = (id: string) => picks[id] ?? suggested.get(id) ?? "";
  const chosen = loose.map((b) => ({ id: b.id, under: pickOf(b.id) })).filter((x) => x.under);
  const [done, setDone] = useState<{ ids: string[]; text: string } | null>(null);

  const apply = async () => {
    const n = chosen.length;
    const count = chosen.reduce((a, x) => a + (info.get(x.id)?.count ?? 0), 0);
    if (!(await confirm(`File ${plural(n, "category", "categories")}?`, `Each stays archived with its own name. Their ${plural(count, "transaction")} count in the category you picked, in Spending and the reports.`, "File them"))) return;
    update((p) => { for (const { id, under } of chosen) { const x = p.budget.find((b) => b.id === id); if (x?.hidden) x.parentId = under; } });
    setDone({ ids: chosen.map((x) => x.id), text: `Filed ${plural(n, "category", "categories")} (${plural(count, "transaction")}).` });
    setPicks({});
  };
  const undo = () => {
    if (!done) return;
    const ids = new Set(done.ids);
    update((p) => { for (const x of p.budget) if (ids.has(x.id) && x.hidden) delete x.parentId; });
    setDone(null);
  };
  const takeOut = (id: string) => update((p) => { const x = p.budget.find((b) => b.id === id); if (x) delete x.parentId; });

  const detail = (b: BudgetItem) => {
    const x = info.get(b.id);
    if (!x) return "No transactions";
    const yrs = year(x.first) === year(x.last) ? year(x.first) : `${year(x.first)}–${year(x.last)}`;
    return [plural(x.count, "transaction"), yrs, x.payees.join(", ")].filter(Boolean).join(" · ");
  };

  const row = (b: BudgetItem) => {
    const pick = pickOf(b.id);
    const sug = suggested.get(b.id);
    return (
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.body, { color: t.text, fontWeight: "600" }]} numberOfLines={1}>{b.name || "Unnamed"}</Text>
          <Text style={[type.caption, { color: t.text3 }]} numberOfLines={2}>{detail(b)}</Text>
          {sug && pick === sug ? <Text style={[type.caption, { color: t.accent }]} numberOfLines={1}>Suggested: same places as {name(sug)}</Text> : null}
        </View>
        <View style={{ maxWidth: "45%" }}>
          <Select
            plain
            label={`Put "${b.name || "Unnamed"}" under`}
            value={pick}
            placeholder="On its own"
            options={[
              { value: "", label: "Leave on its own" },
              ...parentChoices(budget, b.id)
                .sort((x, y) => (x.id === sug ? -1 : y.id === sug ? 1 : 0))
                .map((x) => ({ value: x.id, label: x.name || "Unnamed", hint: x.id === sug ? `${groupOf(x)} · suggested` : groupOf(x) })),
            ]}
            onChange={(v) => { setDone(null); setPicks((s) => ({ ...s, [b.id]: v })); }}
          />
        </View>
      </View>
    );
  };

  return (
    <Screen title="Sort archived categories" back={() => (router.canGoBack() ? router.back() : router.replace("/budget"))} narrow>
      <Text style={[type.body, { color: t.text2 }]}>
        Pick the current category each old one belongs under. It stays archived with its own name, and its history counts in that category: old Restaurants under Dining puts those years in Dining's spending.
      </Text>

      {done ? (
        <View style={[styles.done, { backgroundColor: t.accentSoft }]}>
          <Text role="status" style={[type.label, { color: t.text, flex: 1 }]}>{done.text}</Text>
          <Button title="Undo" tone="ghost" onPress={undo} style={{ minHeight: 32 }} />
        </View>
      ) : null}

      {loose.length ? (
        <Card padded={false}>
          <Text style={[type.overline, { color: t.text3, paddingHorizontal: 16, paddingTop: space.md }]}>On their own ({loose.length})</Text>
          {loose.map((b, i) => (
            <View key={b.id}>
              {i > 0 ? <Divider /> : null}
              {row(b)}
            </View>
          ))}
        </Card>
      ) : (
        <Text style={[type.body, { color: t.text3 }]}>Every archived category is filed under one you use.</Text>
      )}

      {loose.length ? (
        <View style={{ gap: space.xs }}>
          <Button title={chosen.length ? `File ${plural(chosen.length, "category", "categories")}` : "Pick where they go"} tone="primary" disabled={!chosen.length} onPress={() => void apply()} />
          {chosen.length < loose.length ? (
            <Text style={[type.caption, { color: t.text3 }]}>{loose.length - chosen.length === 1 ? "1 stays on its own" : `${loose.length - chosen.length} stay on their own`}. That's fine for ones that don't fit anywhere.</Text>
          ) : null}
        </View>
      ) : null}

      {filed.length ? (
        <Card padded={false}>
          <Text style={[type.overline, { color: t.text3, paddingHorizontal: 16, paddingTop: space.md }]}>Already filed ({filed.length})</Text>
          {filed.map((b, i) => (
            <View key={b.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{b.name || "Unnamed"} → {name(b.parentId)}</Text>
                  <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>{detail(b)}</Text>
                </View>
                <Button title="Take out" tone="ghost" onPress={() => takeOut(b.id)} style={{ minHeight: 32 }} />
              </View>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 16, paddingVertical: 12 },
  done: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, borderRadius: 8 },
});
