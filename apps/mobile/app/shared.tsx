import type { Txn } from "@coastfi/engine";
import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, DateField, NumberInput, Segmented, Select, TextField } from "../components/form";
import { Card, Divider, Screen, SectionLabel } from "../components/ui";
import { isoDay } from "../lib/categories";
import { confirm } from "../lib/confirm";
import { money } from "../lib/format";
import { newId, useStore } from "../lib/store";
import { availableNow, saveMemberTxn, useMembership } from "../lib/sharing";
import { signOut, useSync } from "../lib/sync";
import { space, type, useTheme } from "../lib/theme";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

/**
 * A household member's view of a shared plan: add purchases on the cards they were given, see what's
 * left in each category this month, and fix their own entries. Nothing else of the plan is here.
 */
export default function Shared() {
  const t = useTheme();
  const { status, row, txns } = useMembership();
  const email = useSync((s) => s.email);
  const onboarded = useStore((s) => s.onboarded);
  const view = row?.view ?? null;
  const accounts = view?.accounts.filter((a) => row?.accounts.includes(a.id)) ?? [];
  const [editing, setEditing] = useState<Txn | null>(null);
  const [showAll, setShowAll] = useState(false);
  const avail = useMemo(() => (view ? availableNow(view, txns) : {}), [view, txns]);
  const mine = txns.filter((x) => !x.deleted && row?.accounts.includes(x.accountId));

  if (onboarded) return <Redirect href="/home" />;
  if (status === "none" || (status === "unknown" && !email)) return <Redirect href="/" />;
  if (status !== "member" || !row) {
    return (
      <Screen title="Shared budget" narrow hideSettings>
        <Text role="status" style={[type.body, { color: t.text2 }]}>Loading…</Text>
      </Screen>
    );
  }

  const acctName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Card";
  const catName = (k?: string) => view?.categories.find((c) => c.key === k)?.name ?? "No category";
  const groups = [...new Set((view?.categories ?? []).map((c) => c.group))];
  const monthTitle = view ? `${MONTHS[Number(view.month.slice(5, 7)) - 1]} ${view.month.slice(0, 4)}` : "";
  const stale = view && view.month !== isoDay(new Date()).slice(0, 7);

  return (
    <Screen title="Shared budget" subtitle={email ? `Signed in as ${email}` : undefined} narrow hideSettings>
      {!accounts.length ? (
        <Card>
          <Text style={[type.body, { color: t.text2 }]}>
            {view ? "No cards are shared with you right now." : "Almost ready: the cards shared with you show up once the plan's owner opens Coastline."}
          </Text>
        </Card>
      ) : (
        <TxnEditor
          key={editing?.id ?? "new"}
          txn={editing}
          accounts={accounts}
          categories={view?.categories ?? []}
          avail={avail}
          onDone={() => setEditing(null)}
        />
      )}

      {view && view.categories.length ? (
        <View style={{ gap: space.sm }}>
          <SectionLabel>What&apos;s left in {monthTitle}</SectionLabel>
          {stale ? <Text style={[type.caption, { color: t.text3 }]}>From {monthTitle}. This month&apos;s amounts show up once the plan&apos;s owner opens Coastline.</Text> : null}
          <Card padded={false}>
            {groups.map((g, gi) => (
              <View key={g}>
                {gi > 0 ? <Divider /> : null}
                <Text style={[type.overline, styles.group, { color: t.text3 }]}>{g}</Text>
                {view.categories.filter((c) => c.group === g).map((c) => {
                  const v = avail[c.key] ?? 0;
                  return (
                    <View key={c.key} style={styles.row}>
                      <Text numberOfLines={1} style={[type.body, { color: t.text, flex: 1 }]}>{c.name}</Text>
                      <Text style={[type.body, { color: v < -0.005 ? t.bad : v > 0.005 ? t.good : t.text3, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{money(v)}</Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </Card>
          <Text style={[type.caption, { color: t.text3 }]}>Red means a category is overspent.</Text>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <SectionLabel>Transactions on your cards</SectionLabel>
        {mine.length ? (
          <Card padded={false}>
            {(showAll ? mine : mine.slice(0, 25)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.updatedAt - a.updatedAt)).map((x, i) => (
              <View key={x.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable role="button" accessibilityLabel={`Edit ${x.payee || "transaction"} ${money(Math.abs(x.amount))}`} onPress={() => setEditing(x)} style={(st) => [styles.row, { backgroundColor: st.pressed ? t.surface2 : "transparent" }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[type.body, { color: t.text, fontWeight: "500" }]}>{x.payee || "No payee"}</Text>
                    <Text numberOfLines={1} style={[type.caption, { color: t.text3 }]}>{dayText(x.date)} · {acctName(x.accountId)} · {catName(x.categoryId)}</Text>
                  </View>
                  <Text style={[type.body, { color: x.amount > 0 ? t.good : t.text, fontVariant: ["tabular-nums"] }]}>{x.amount > 0 ? "+" : ""}{money(x.amount)}</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : (
          <Text style={[type.caption, { color: t.text3 }]}>None yet.</Text>
        )}
        {!showAll && mine.length > 25 ? <Button title={`Show all ${mine.length}`} tone="ghost" onPress={() => setShowAll(true)} style={{ alignSelf: "flex-start" }} /> : null}
      </View>

      <Button
        title="Sign out"
        tone="ghost"
        onPress={() => void (async () => { if (await confirm("Sign out?", "You can sign back in with your email any time.", "Sign out")) await signOut(true); })()}
        style={{ alignSelf: "flex-start" }}
      />
    </Screen>
  );
}

function TxnEditor({
  txn, accounts, categories, avail, onDone,
}: {
  txn: Txn | null;
  accounts: { id: string; name: string }[];
  categories: { key: string; name: string; group: string }[];
  avail: Record<string, number>;
  onDone: () => void;
}) {
  const t = useTheme();
  const [kind, setKind] = useState<"out" | "in">(txn && txn.amount > 0 ? "in" : "out");
  const [amount, setAmount] = useState(txn ? Math.abs(txn.amount) : 0);
  const [payee, setPayee] = useState(txn?.payee ?? "");
  const [account, setAccount] = useState(txn?.accountId ?? accounts[0]!.id);
  const [cat, setCat] = useState(txn?.categoryId ?? "");
  const [date, setDate] = useState(txn?.date ?? isoDay(new Date()));
  const [memo, setMemo] = useState(txn?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const left = cat ? avail[cat] : undefined;

  const save = async (deleted = false) => {
    if (!deleted && !(amount > 0)) return setMsg("Enter an amount.");
    setBusy(true);
    setMsg(null);
    try {
      await saveMemberTxn({
        id: txn?.id ?? newId(),
        accountId: account,
        date,
        amount: Math.round((kind === "out" ? -amount : amount) * 100) / 100,
        ...(payee.trim() ? { payee: payee.trim() } : {}),
        ...(memo.trim() ? { memo: memo.trim() } : {}),
        ...(cat ? { categoryId: cat } : {}),
        cleared: txn?.cleared ?? "uncleared",
        source: "manual",
        updatedAt: Date.now(),
        ...(deleted ? { deleted: true } : {}),
      });
      if (!txn) {
        setAmount(0);
        setPayee("");
        setMemo("");
        setMsg(deleted ? null : "Saved.");
      } else onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <Text role="heading" aria-level={2} style={[type.heading, { color: t.text }]}>{txn ? "Edit transaction" : "Add a purchase"}</Text>
      <Segmented label="Money out or in" options={[{ value: "out", label: "Spent" }, { value: "in", label: "Refund" }]} value={kind} onChange={setKind} />
      <View style={styles.fields}>
        <NumberInput kind="money" label="Amount" value={amount} onChange={setAmount} width={150} stepper={false} />
        <DateField label="Date" value={date} onChange={(v) => v && setDate(v)} />
      </View>
      <TextField label="Where" placeholder="Store or payee" value={payee} onChange={setPayee} />
      {accounts.length > 1 ? <Select label="Card" options={accounts.map((a) => ({ value: a.id, label: a.name }))} value={account} onChange={setAccount} /> : <Text style={[type.caption, { color: t.text2 }]}>Card: {accounts[0]!.name}</Text>}
      {categories.length ? (
        <Select
          label="Category"
          placeholder="Pick a category"
          options={[{ value: "", label: "No category (the owner sorts it out)" }, ...categories.map((c) => ({ value: c.key, label: c.name, hint: `${c.group} · ${money(avail[c.key] ?? 0)} left` }))]}
          value={cat}
          onChange={setCat}
        />
      ) : null}
      {left !== undefined ? (
        <Text style={[type.caption, { color: left - (kind === "out" ? amount : -amount) < -0.005 ? t.bad : t.text2 }]}>
          {money(left)} left in {categories.find((c) => c.key === cat)?.name}
          {amount > 0 ? ` · ${money(left - (kind === "out" ? amount : -amount))} after this` : ""}
        </Text>
      ) : null}
      <TextField label="Note" placeholder="Note (optional)" value={memo} onChange={setMemo} />
      <View style={styles.fields}>
        <Button title={busy ? "Saving…" : txn ? "Save" : "Add"} tone="primary" disabled={busy} onPress={() => void save()} />
        {txn ? <Button title="Cancel" tone="ghost" onPress={onDone} /> : null}
        {txn ? (
          <Button
            title="Delete"
            icon="trash"
            tone="danger"
            onPress={() => void (async () => { if (await confirm("Delete this transaction?", "It's removed from the budget too.", "Delete")) await save(true); })()}
          />
        ) : null}
      </View>
      {msg ? <Text role="status" style={[type.caption, { color: t.text2 }]}>{msg}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 52 },
  group: { paddingHorizontal: space.lg, paddingTop: space.md },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "center" },
});
