/**
 * Payees: every name you've paid, how often, and its usual category. Pick several written different
 * ways ("CHICK-FIL-A #123", "Chick-fil-A") and combine them into one, or rename one. Names that look
 * alike are suggested at the top.
 */
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, TextField } from "../../../components/form";
import { Icon } from "../../../components/Icon";
import { Card, Divider, Screen } from "../../../components/ui";
import { useCategories } from "../../../lib/categories";
import { confirm } from "../../../lib/confirm";
import { buildPayees, similarPayees, type PayeeInfo } from "../../../lib/payees";
import { useStore } from "../../../lib/store";
import { radius, space, type, useTheme } from "../../../lib/theme";

export default function Payees() {
  const t = useTheme();
  const router = useRouter();
  const txns = useStore((s) => s.txns);
  const renamePayees = useStore((s) => s.renamePayees);
  const cats = useCategories();
  const payees = useMemo(() => buildPayees(txns), [txns]);
  const similar = useMemo(() => similarPayees(payees), [payees]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [done, setDone] = useState("");

  const all = [...payees.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const shown = q.trim() ? all.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : all;
  const catName = (id?: string) => (id ? cats.find((c) => c.key === id)?.label : undefined);
  const toggle = (p: PayeeInfo) => {
    setDone("");
    setPicked((s) => {
      const next = s.includes(p.name) ? s.filter((x) => x !== p.name) : [...s, p.name];
      // the name to keep: the most used of the picked ones (you can change it)
      const top = next.map((n) => payees.get(n.toLowerCase())!).filter(Boolean).sort((a, b) => b.count - a.count || a.name.length - b.name.length)[0];
      setName(top?.name ?? "");
      return next;
    });
  };
  const pickGroup = (g: PayeeInfo[]) => {
    setDone("");
    setPicked(g.map((p) => p.name));
    setName(g[0]!.name);
  };
  const count = picked.reduce((a, n) => a + (payees.get(n.toLowerCase())?.count ?? 0), 0);
  const apply = async () => {
    const to = name.trim();
    if (!to) return;
    const what = picked.length > 1 ? `Combine ${picked.length} payees into "${to}"?` : `Rename "${picked[0]}" to "${to}"?`;
    if (!(await confirm(what, `${count} transaction${count === 1 ? "" : "s"} will say "${to}". The new name is suggested from then on.`, picked.length > 1 ? "Combine" : "Rename"))) return;
    renamePayees(picked, to);
    setDone(`${count} transaction${count === 1 ? "" : "s"} now say "${to}".`);
    setPicked([]);
    setName("");
  };

  const row = (p: PayeeInfo) => {
    const on = picked.includes(p.name);
    return (
      <Pressable
        key={p.name}
        role="checkbox"
        aria-checked={on}
        accessibilityLabel={`${p.name}, ${p.count} transaction${p.count === 1 ? "" : "s"}`}
        onPress={() => toggle(p)}
        style={({ pressed }) => [styles.row, pressed ? { backgroundColor: t.surface2 } : null]}
      >
        <View style={[styles.box, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : "transparent" }]}>
          {on ? <Icon name="check" size={14} color={t.bg} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.body, { color: t.text }]}>{p.name}</Text>
          {catName(p.categoryId) ? <Text numberOfLines={1} style={[type.caption, { color: t.text3 }]}>{catName(p.categoryId)}</Text> : null}
        </View>
        <Text style={[type.caption, { color: t.text3, fontVariant: ["tabular-nums"] }]}>{p.count}×</Text>
      </Pressable>
    );
  };

  return (
    <Screen title="Payees" back={() => (router.canGoBack() ? router.back() : router.replace("/budget?view=transactions"))} narrow>
      <Text style={[type.body, { color: t.text2 }]}>
        Pick the ones that are the same place written different ways and combine them, or pick one to rename it. Every transaction changes, and the new name is suggested from then on.
      </Text>

      {picked.length ? (
        <Card style={{ gap: space.sm, borderColor: t.accent }}>
          <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>
            {picked.length > 1 ? `Combine ${picked.length} payees (${count} transactions)` : `Rename (${count} transaction${count === 1 ? "" : "s"})`}
          </Text>
          <Text numberOfLines={2} style={[type.caption, { color: t.text3 }]}>{picked.join(" · ")}</Text>
          <TextField label={picked.length > 1 ? "Combine into" : "New name"} placeholder="Payee name" value={name} onChange={setName} />
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            <Button title={picked.length > 1 ? "Combine" : "Rename"} tone="primary" disabled={!name.trim()} onPress={() => void apply()} />
            <Button title="Clear" tone="ghost" onPress={() => { setPicked([]); setName(""); }} />
          </View>
        </Card>
      ) : null}
      {done ? <Text role="status" style={[type.label, { color: t.good }]}>{done}</Text> : null}

      {similar.length ? (
        <Card style={{ gap: space.sm }}>
          <Text style={[type.overline, { color: t.text3 }]}>Look alike</Text>
          {similar.slice(0, 8).map((g, i) => (
            <View key={g[0]!.name}>
              {i > 0 ? <Divider /> : null}
              <View style={[styles.similar, { paddingTop: i > 0 ? space.sm : 0 }]}>
                <Text numberOfLines={2} style={[type.body, { color: t.text, flex: 1, minWidth: 0 }]}>{g.map((p) => p.name).join(" · ")}</Text>
                <Pressable role="button" onPress={() => pickGroup(g)} hitSlop={6}>
                  <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Pick these</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      <TextField label="Search payees" placeholder="Search payees" value={q} onChange={setQ} />
      {shown.length ? (
        <Card padded={false}>
          {shown.map((p, i) => (
            <View key={p.name}>
              {i > 0 ? <Divider /> : null}
              {row(p)}
            </View>
          ))}
        </Card>
      ) : (
        <Text style={[type.body, { color: t.text3 }]}>{all.length ? "No payee matches." : "No payees yet. They come from your transactions."}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 16, paddingVertical: 12 },
  box: { width: 20, height: 20, borderRadius: radius.sm, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  similar: { flexDirection: "row", alignItems: "center", gap: space.md },
});
