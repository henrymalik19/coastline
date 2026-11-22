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
import { connectBank, connectTestBank, disconnectBank, loadBankAccess, loadBanks, reconnectBank, syncBanks, usePlaid, type BankItem } from "../lib/plaid";
import { bankLabel, matchOf, type BankAccount } from "../lib/plaidMatch";
import { usePlan } from "../lib/plan";
import { supabase } from "../lib/supabase";
import { useSync } from "../lib/sync";
import { space, type, useTheme } from "../lib/theme";
import { Button, IconButton, InfoText, InfoTip, Select } from "./form";
import { Card, SectionLabel } from "./ui";
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

/**
 * Load this plan's banks and whether you may connect new ones, and say whether banks show at all:
 * until they open to everyone, only to people allowed to connect, or whose plan already has one
 * (signed out, not allowed, or not known yet: nothing).
 */
export function useBanks(): boolean {
  const planId = useSync((s) => s.planId);
  const userId = useSync((s) => s.userId);
  const { items, loaded, canLink } = usePlaid();
  useEffect(() => {
    if (BANKS_ON && supabase && planId && userId && (!loaded || usePlaid.getState().planId !== planId)) void loadBanks();
  }, [planId, userId, loaded]);
  useEffect(() => {
    if (BANKS_ON && supabase && planId && userId) void loadBankAccess();
  }, [planId, userId]);
  return BANKS_ON && !!supabase && !!planId && !!userId && (canLink === true || items.length > 0);
}

/** "Connect an account": the question only picks which firms Plaid lists; every account at the firm comes along. */
function ConnectButton() {
  const { items, busy } = usePlaid();
  return (
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
  );
}

/**
 * Accounts: just the Connect button, and a line for anything that needs you (a bank to sign in to
 * again, accounts not set up yet). Everything else about banks is in Settings → Connected banks.
 */
export function BankBar() {
  const t = useTheme();
  // Back on the banks page returns here (Accounts), not to the Settings list
  const openPage = useOpenPage();
  const visible = useBanks();
  const { items, accounts, canLink, error } = usePlaid();
  const { state } = usePlan();
  if (!visible || Platform.OS !== "web") return null;
  const alerts = items.flatMap((it) => {
    const out: { key: string; text: string; onPress: () => void }[] = [];
    if (it.status === "login_required" || it.status === "pending_expiration")
      out.push({ key: `${it.id}-login`, text: `${it.institution} needs you to sign in again`, onPress: () => void reconnectBank(it.id) });
    else if (it.status === "error") out.push({ key: `${it.id}-err`, text: `${it.institution} couldn't update`, onPress: () => openPage("/settings/banks") });
    const loose = accounts.filter((b) => b.item === it.id && !matchOf(state, b)).length;
    if (loose) out.push({ key: `${it.id}-loose`, text: `${loose} ${it.institution} account${loose === 1 ? "" : "s"} not set up`, onPress: () => usePlaid.setState({ review: it.id }) });
    return out;
  });
  return (
    <View style={{ gap: space.sm }}>
      <View style={[styles.between, { flexWrap: "wrap" }]}>
        {canLink ? <ConnectButton /> : <View />}
        {items.length ? (
          <Text role="link" onPress={() => openPage("/settings/banks")} style={[type.caption, { color: t.accent, fontWeight: "700" }]}>
            Manage banks
          </Text>
        ) : null}
      </View>
      {alerts.map((a) => (
        <Text key={a.key} role="button" onPress={a.onPress} style={[type.caption, { color: t.warn, fontWeight: "600" }]}>
          {a.text} ›
        </Text>
      ))}
      {error ? <Text role="alert" style={[type.caption, { color: t.bad }]}>{error}</Text> : null}
    </View>
  );
}

/** Settings → Connected banks: every bank, its status, Refresh, Review accounts, Disconnect, and Connect. */
function BankCard() {
  const t = useTheme();
  const router = useRouter();
  const openPage = useOpenPage();
  const visible = useBanks();
  const planId = useSync((s) => s.planId);
  const userId = useSync((s) => s.userId);
  const { items, accounts, busy, error, canLink, accessFailed } = usePlaid();
  const [tip, setTip] = useState(false);
  if (!visible)
    return (
      <Text role="status" style={[type.body, { color: t.text2 }]}>
        {canLink === false
          ? "Connecting banks isn't available for your account yet."
          : accessFailed
            ? "Couldn't reach the bank connection service. Check your connection and try again."
            : "Loading your banks…"}
      </Text>
    );
  const signedIn = !!planId && !!userId;
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
              <ConnectButton />
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
  const { state } = usePlan();
  const loose = accounts.filter((b) => !matchOf(state, b));
  const linked = accounts.length - loose.length;
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
      {/* only what still needs a decision; linked ones show in your Accounts list, tagged Linked */}
      {loose.map((b) => (
        <LinkLine key={b.id} b={b} />
      ))}
      {!accounts.length ? <Text style={[type.caption, { color: t.text3 }]}>No accounts yet.</Text> : null}
      {accounts.length ? (
        <View style={styles.between}>
          <Text style={[type.caption, { color: t.text3 }]}>
            {linked ? `${linked} account${linked === 1 ? "" : "s"} linked` : ""}
            {linked && loose.length ? " · " : ""}
            {loose.length ? `${loose.length} not used` : ""}
          </Text>
          <Text role="button" onPress={() => usePlaid.setState({ review: item.id })} style={[type.caption, { color: t.accent, fontWeight: "700" }]}>
            {loose.length ? "Set up" : "Review"}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** One bank account in a line: what it updates in your plan, or that it isn't used. */
function LinkLine({ b }: { b: BankAccount }) {
  const t = useTheme();
  const { state } = usePlan();
  const m = matchOf(state, b);
  return (
    <View style={styles.between}>
      <Text style={[type.caption, { color: t.text2, flexShrink: 1 }]} numberOfLines={1}>{bankLabel(b)}</Text>
      <Text style={[type.caption, { color: m ? t.text : t.text3, fontWeight: m ? "600" : "400" }]} numberOfLines={1}>
        {m ? `→ ${m.item.name || "your account"}` : "Not used"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  small: { minHeight: 36, paddingHorizontal: space.md },
  item: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xs, gap: 2 },
});
