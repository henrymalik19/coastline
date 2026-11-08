import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { confirm } from "../lib/confirm";
import { usePlan } from "../lib/plan";
import { budgetAccounts } from "../lib/register";
import { inviteMember, loadMembers, removeMember, SHARE_RULES, updateMember, useSharing, type MemberRow } from "../lib/sharing";
import { syncConfigured } from "../lib/supabase";
import { useSync } from "../lib/sync";
import { space, type, useTheme } from "../lib/theme";
import { Button, FieldRow, TextField, Toggle } from "./form";
import { Card, Divider } from "./ui";

/** Where a member signs in (this site on the web). */
const appUrl = () => (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "the Coastline app");

/**
 * Invite someone (a spouse, a partner) to add purchases on the cards you pick. They sign in with
 * their own email and see only those cards and what's left in each category this month.
 */
export function SharingEditor() {
  const t = useTheme();
  const { state } = usePlan();
  const { email: myEmail } = useSync();
  const { members, available, error } = useSharing();
  const accts = budgetAccounts(state);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (myEmail) void loadMembers();
  }, [myEmail]);

  if (!syncConfigured || !myEmail) {
    return (
      <Card>
        <Text style={[type.body, { color: t.text2 }]}>Sign in first (Settings → Account & sync). Sharing works through your account.</Text>
      </Card>
    );
  }
  if (!available) {
    return (
      <Card>
        <Text style={[type.body, { color: t.text2 }]}>Sharing isn't turned on for this server yet.</Text>
      </Card>
    );
  }
  if (!state.budgetPlan || !accts.length) {
    return (
      <Card>
        <Text style={[type.body, { color: t.text2 }]}>Start your monthly budget on the Budget tab first. You share the cards and accounts you spend from there.</Text>
      </Card>
    );
  }

  const acctName = (id: string) => accts.find((a) => a.id === id)?.name ?? "Removed account";
  const toggles = (chosen: string[], onChange: (next: string[]) => void) =>
    accts.map((a) => (
      <FieldRow key={a.id} label={a.name} hint={a.kind === "card" ? "Credit card" : "Cash"}>
        <Toggle label={`Share ${a.name}`} value={chosen.includes(a.id)} onChange={(v) => onChange(v ? [...chosen, a.id] : chosen.filter((x) => x !== a.id))} />
      </FieldRow>
    ));

  const invite = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await inviteMember(email, name, pick);
      setMsg(`Invited. Have ${name.trim() || "them"} open ${appUrl()}, tap Sign in and use ${email.trim().toLowerCase()}. They'll get a code by email.`);
      setEmail("");
      setName("");
      setPick([]);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.lg }}>
      <Text style={[type.body, { color: t.text2 }]}>
        Let someone add purchases on cards you pick, from their own phone. They sign in with their own email.
      </Text>
      <ShareRules who="They" />
      {error ? <Text role="alert" style={[type.caption, { color: t.bad }]}>{error}</Text> : null}
      {members.map((m) => (
        <MemberCard key={m.email} m={m} toggles={toggles} acctName={acctName} />
      ))}
      <Card style={{ gap: space.sm }}>
        <Text role="heading" aria-level={2} style={[type.heading, { color: t.text }]}>Invite someone</Text>
        <TextField label="Their email" placeholder="name@example.com" value={email} onChange={setEmail} />
        <TextField label="Their name" placeholder="Name (optional)" value={name} onChange={setName} />
        <Text style={[type.label, { color: t.text2, marginTop: space.xs }]}>Cards and accounts they can use</Text>
        <View>
          {toggles(pick, setPick).map((row, i) => (
            <View key={i}>
              {i > 0 ? <Divider /> : null}
              {row}
            </View>
          ))}
        </View>
        <Button title={busy ? "Inviting…" : "Invite"} tone="primary" disabled={busy || !email.trim() || !pick.length} onPress={() => void invite()} style={{ alignSelf: "flex-start" }} />
        {!pick.length ? <Text style={[type.caption, { color: t.text3 }]}>Pick at least one card.</Text> : null}
        {msg ? <Text role="status" style={[type.caption, { color: t.text2 }]}>{msg}</Text> : null}
      </Card>
    </View>
  );
}

/** The sharing rules as three short lists. `who` is "They" (the owner's view) or "You" (the member's). */
export function ShareRules({ who }: { who: "They" | "You" }) {
  const t = useTheme();
  const list = (title: string, items: readonly string[], mark: string, color: string) => (
    <View style={{ gap: space.xs }}>
      <Text style={[type.label, { color: t.text }]}>{title}</Text>
      {items.map((s) => (
        <View key={s} style={{ flexDirection: "row", gap: space.sm }}>
          <Text aria-hidden style={[type.body, { color, width: 14, fontWeight: "700" }]}>{mark}</Text>
          <Text style={[type.body, { color: t.text2, flex: 1 }]}>{s}</Text>
        </View>
      ))}
    </View>
  );
  return (
    <Card style={{ gap: space.md }}>
      {list(`${who} can see`, SHARE_RULES.sees, "✓", t.good)}
      {list(`${who} can`, who === "You" ? SHARE_RULES.does.map((s) => s.replace(" they added", " you added")) : SHARE_RULES.does, "✓", t.good)}
      {list(`${who} can't see or do`, who === "You" ? SHARE_RULES.cant.map((s) => s.replace("someone else added", "you didn't add")) : SHARE_RULES.cant.map((s) => s.replace("someone else added", "they didn't add")), "✕", t.bad)}
    </Card>
  );
}

function MemberCard({ m, toggles, acctName }: { m: MemberRow; toggles: (chosen: string[], onChange: (next: string[]) => void) => React.ReactNode[]; acctName: (id: string) => string }) {
  const t = useTheme();
  const [err, setErr] = useState<string | null>(null);
  const who = m.name?.trim() || m.email;
  const status = m.joined_at ? `Joined ${new Date(m.joined_at).toLocaleDateString([], { month: "short", day: "numeric" })}` : "Invited · hasn't signed in yet";
  const save = (accounts: string[]) => updateMember(m.email, { accounts }).catch((e: Error) => setErr(e.message));
  const remove = async () => {
    if (!(await confirm(`Stop sharing with ${who}?`, "They won't be able to see or add transactions anymore. What they already added stays in your budget.", "Stop sharing"))) return;
    await removeMember(m.email).catch((e: Error) => setErr(e.message));
  };
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ gap: 2 }}>
        <Text style={[type.heading, { color: t.text }]}>{who}</Text>
        <Text style={[type.caption, { color: t.text3 }]}>
          {m.name ? `${m.email} · ` : ""}
          {status}
        </Text>
        <Text style={[type.caption, { color: t.text3 }]}>Can use: {m.accounts.length ? m.accounts.map(acctName).join(", ") : "nothing yet"}</Text>
      </View>
      <View>
        {toggles(m.accounts, (next) => void save(next)).map((row, i) => (
          <View key={i}>
            {i > 0 ? <Divider /> : null}
            {row}
          </View>
        ))}
      </View>
      {err ? <Text role="alert" style={[type.caption, { color: t.bad }]}>{err}</Text> : null}
      <Button title="Stop sharing" icon="trash" tone="danger" onPress={() => void remove()} style={{ alignSelf: "flex-start", minHeight: 36 }} />
    </Card>
  );
}
