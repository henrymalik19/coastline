/**
 * Money → Accounts: connected banks (Plaid). Connect a bank or card, or an investment account; match each
 * of its accounts to one of yours (or add it as a new one, or leave it out); reconnect or disconnect.
 * Balances then come in on their own.
 */
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { confirm } from "../lib/confirm";
import { BANKS_ON } from "../lib/features";
import { money } from "../lib/format";
import { applyBanks, connectBank, connectTestBank, disconnectBank, loadBankAccess, loadBanks, reconnectBank, syncBanks, usePlaid, type BankItem } from "../lib/plaid";
import { bankLabel, bankSaysCash, isDebtLike, kindDiffers, matchOf, matchOptions, newFromBank, setMatch, type BankAccount } from "../lib/plaidMatch";
import { ACCOUNT_TYPES } from "./AccountsEditor";
import { usePlan } from "../lib/plan";
import { hasRegister } from "../lib/register";
import { newId, useStore } from "../lib/store";
import { supabase } from "../lib/supabase";
import { useSync } from "../lib/sync";
import { space, type, useTheme } from "../lib/theme";
import { Button, IconButton, InfoText, InfoTip, Select } from "./form";
import { Card, Divider, SectionLabel } from "./ui";
import { useOpenPage } from "../lib/nav";

const INFO =
  "Connect your bank, cards and investment accounts through Plaid, and their balances come in on their own (about once a day). Match each one to an account or debt here, add it as a new one, or leave it out. Coastwise only reads balances; it can't move money. You sign in to each bank once (in Plaid's window, never in Coastwise); one sign-in brings in all your accounts there. Now and then a bank asks you to reconnect.";

function ago(iso?: string | null): string {
  if (!iso) return "not yet";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** The card, when bank connections are switched on (lib/features.ts). */
export function BankConnections() {
  return BANKS_ON ? <BankCard /> : null;
}

function BankCard() {
  const t = useTheme();
  const router = useRouter();
  const openPage = useOpenPage();
  const planId = useSync((s) => s.planId);
  const userId = useSync((s) => s.userId);
  const { items, accounts, busy, error, loaded, canLink } = usePlaid();
  const [tip, setTip] = useState(false);
  useEffect(() => {
    if (supabase && planId && userId && (!loaded || usePlaid.getState().planId !== planId)) void loadBanks();
  }, [planId, userId, loaded]);
  useEffect(() => {
    if (supabase && planId && userId) void loadBankAccess();
  }, [planId, userId]);
  if (!supabase) return null;
  const signedIn = !!planId && !!userId;
  // until banks open to everyone: only people allowed to connect see this card (signed out, not
  // allowed, or not known yet: nothing), plus anyone whose plan already has a connection
  if (!signedIn || (canLink !== true && !items.length)) return null;
  const web = Platform.OS === "web";

  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.between}>
        <View style={[styles.row, { flexShrink: 1 }]}>
          <SectionLabel flush>Connected banks</SectionLabel>
          <InfoTip text={INFO} label="Connected banks" open={tip} onToggle={setTip} />
        </View>
        {signedIn && items.length ? <Button title="Refresh" tone="ghost" disabled={busy} onPress={() => void syncBanks(true)} style={{ minHeight: 32, paddingHorizontal: space.sm }} /> : null}
      </View>
      {tip ? <InfoText text={INFO} /> : null}

      {!signedIn ? (
        <View style={{ gap: space.sm }}>
          <Text style={[type.body, { color: t.text2 }]}>Connect your bank and balances stay up to date on their own. It uses your Coastwise account, so you'll sign in to that first (once on this device).</Text>
          <Button title="Connect a bank" icon="plus" onPress={() => openPage("/settings/account")} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : (
        <>
          {items.map((it) => (
            <ItemBlock key={it.id} item={it} accounts={accounts.filter((a) => a.item === it.id)} busy={busy} />
          ))}
          {error ? <Text role="alert" style={[type.caption, { color: t.bad }]}>{error}</Text> : null}
          {canLink === false ? (
            // before banks open to everyone: only admins and people on the list can connect new ones
            <Text style={[type.caption, { color: t.text3 }]}>Connecting banks is coming soon. Until then, add your accounts and update their balances yourself.</Text>
          ) : web ? (
            <View style={{ gap: 6 }}>
              {/* one button; the question only picks which firms Plaid lists (every account at the firm comes along) */}
              <Select
                label="What are you connecting?"
                value=""
                options={[
                  { value: "bank", label: "A bank or credit card", hint: "Checking, savings, cards, loans" },
                  { value: "investments", label: "An investment or retirement account", hint: "Brokerage, IRA, 401(k), HSA" },
                ]}
                onChange={(k) => void connectBank(k as "bank" | "investments")}
                trigger={(open) => <Button title={items.length ? "Connect another account" : "Connect an account"} icon="plus" disabled={busy} onPress={open} style={{ alignSelf: "flex-start" }} />}
              />
              <Text style={[type.caption, { color: t.text3 }]}>Every account you have at that bank comes along, checking and brokerage alike. Use each one as whatever it is to you.</Text>
              <Text style={[type.caption, { color: t.text3 }]}>
                How we handle bank data:{" "}
                <Text role="link" style={{ color: t.accent, fontWeight: "600" }} onPress={() => router.push("/privacy")}>privacy policy</Text>
              </Text>
              {__DEV__ ? (
                <View style={styles.wrap}>
                  <Button title="Test bank (Sandbox)" tone="ghost" disabled={busy} onPress={() => void connectTestBank("bank")} style={styles.small} />
                  <Button title="Test investments (Sandbox)" tone="ghost" disabled={busy} onPress={() => void connectTestBank("investments")} style={styles.small} />
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={[type.caption, { color: t.text3 }]}>Connecting a bank works in the web app for now. Banks you connect there update here too.</Text>
          )}
        </>
      )}
    </Card>
  );
}

function ItemBlock({ item, accounts, busy }: { item: BankItem; accounts: BankAccount[]; busy: boolean }) {
  const t = useTheme();
  const needsLogin = item.status === "login_required" || item.status === "pending_expiration";
  const status =
    item.status === "ok" ? `Updated ${ago(item.lastSyncedAt)}`
    : needsLogin ? "Needs reconnecting"
    : "Couldn't update. Try Refresh, or reconnect";
  return (
    <View style={[styles.item, { borderColor: t.border }]}>
      <View style={styles.between}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.body, { color: t.text, fontWeight: "700" }]} numberOfLines={1}>{item.institution}</Text>
          <Text style={[type.caption, { color: item.status === "ok" ? t.text3 : t.warn }]} numberOfLines={1}>{status}</Text>
        </View>
        {needsLogin || item.status === "error" ? <Button title="Reconnect" tone={needsLogin ? "primary" : "secondary"} disabled={busy} onPress={() => void reconnectBank(item.id)} style={styles.small} /> : null}
        <IconButton
          icon="trash"
          color={t.bad}
          label={`Disconnect ${item.institution}`}
          onPress={async () => {
            if (await confirm(`Disconnect ${item.institution}?`, "Its balances stop updating. Your accounts and debts stay, with the balances they have now.", "Disconnect")) void disconnectBank(item.id);
          }}
        />
      </View>
      {accounts.map((b, i) => (
        <View key={b.id}>
          {i > 0 ? <Divider /> : null}
          <BankRow b={b} company={item.institution} />
        </View>
      ))}
      {!accounts.length ? <Text style={[type.caption, { color: t.text3 }]}>No accounts yet.</Text> : null}
    </View>
  );
}

function BankRow({ b, company }: { b: BankAccount; company?: string }) {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const txns = useStore((s) => s.txns);
  const debt = isDebtLike(b);
  const m = matchOf(state, b);
  const value = m ? `${m.kind === "account" ? "a" : "d"}:${m.item.id}` : "";
  // every account you have, likeliest first (nothing hidden by type: a brokerage can be your checking)
  const choices = matchOptions(state, b, company);
  const options = [
    { value: "", label: "Not used" },
    ...(debt
      ? [{ value: "new", label: "Add as a new debt", section: "New" }]
      : bankSaysCash(b)
        ? [{ value: "new", label: "Add as a new cash account", section: "New" }]
        : [
            { value: "new", label: "Add as a new investment account", section: "New" },
            { value: "new-cash", label: "Add as a new cash account", hint: "If you use it like a checking or savings account", section: "New" },
          ]),
    ...choices.map((c) => ({
      value: `${c.kind === "account" ? "a" : "d"}:${c.id}`,
      label: c.name,
      ...(c.type ? { hint: typeLabel(c.type) } : {}),
      section: c.likely ? "Likely matches" : debt ? "Your debts" : "Your other accounts",
    })),
  ];
  const onPick = (v: string) => {
    update((p) => {
      if (v === "") return setMatch(p, b, null);
      if (v === "new" || v === "new-cash") {
        setMatch(p, b, null);
        const n = newFromBank(b, newId(), company && company !== "Bank" ? company : undefined, v === "new-cash");
        if (n.kind === "debt") p.debts.push(n.debt);
        else p.accounts.push(n.account);
        return;
      }
      setMatch(p, b, { kind: v.startsWith("d:") ? "debt" : "account", id: v.slice(2) });
    });
    applyBanks();
  };
  const reg = m && hasRegister(txns, m.item.id);
  return (
    <View style={{ gap: 2, paddingVertical: space.sm }}>
      <View style={styles.between}>
        <Text style={[type.body, { color: t.text, flex: 1, minWidth: 0 }]} numberOfLines={1}>{bankLabel(b)}</Text>
        <Text style={[type.body, { color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>
          {b.current == null ? "–" : `${debt ? "owe " : ""}${money(Math.max(0, b.current))}`}
        </Text>
      </View>
      <View style={styles.between}>
        <Text style={[type.caption, { color: t.text3 }]}>{m ? "Updates" : "Use as"}</Text>
        <View style={{ flex: 1, minWidth: 0, maxWidth: 240 }}>
          <Select plain label={`Use ${bankLabel(b)} as`} options={options} value={value} onChange={onPick} />
        </View>
      </View>
      {reg ? <Text style={[type.caption, { color: t.text3 }]}>Its balance comes from your Budget register, so it isn't changed here.</Text> : null}
      {m?.kind === "account" && kindDiffers(m.item, b) ? (
        // your type stands; just say so, with a way to switch if it was a slip
        <Text style={[type.caption, { color: t.text3 }]}>
          {company && company !== "Bank" ? company : "The bank"} calls this {bankSaysCash(b) ? "a checking or savings account" : "an investment account"}. It counts as{" "}
          {m.item.type === "cash" ? "cash" : "investments"} in your plan, the way you set it.{" "}
          <Text
            role="button"
            style={{ color: t.accent, fontWeight: "700" }}
            onPress={() => update((p) => { const a = p.accounts.find((x) => x.id === m.item.id); if (a) a.type = bankSaysCash(b) ? "cash" : "taxable"; })}
          >
            Count it as {bankSaysCash(b) ? "cash" : "investments"} instead
          </Text>
        </Text>
      ) : null}
    </View>
  );
}

/** An account type in words (Cash, Roth, ...). */
const typeLabel = (k: string) => ACCOUNT_TYPES.find((x) => x.value === k)?.label ?? k;

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  small: { minHeight: 36, paddingHorizontal: space.md },
  item: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xs, gap: 2 },
});
