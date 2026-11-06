import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { confirm } from "../lib/confirm";
import { deleteAccount, sendCode, signOut, syncNow, useSync, verifyCode, type SyncStatus } from "../lib/sync";
import { syncConfigured } from "../lib/supabase";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, TextField } from "./form";
import { Card } from "./ui";

const STATUS_TEXT: Record<SyncStatus, string> = {
  off: "Sync isn't set up in this build",
  signedOut: "Not signed in",
  syncing: "Syncing…",
  synced: "Synced",
  offline: "Offline. Changes are saved on this device and will sync when you're back online.",
  error: "Couldn't sync",
};

export function SyncStatusLine() {
  const t = useTheme();
  const { status, lastSyncedAt, error } = useSync();
  const color = status === "error" ? t.bad : status === "offline" ? t.warn : status === "synced" ? t.good : t.text3;
  const when = status === "synced" && lastSyncedAt ? ` · ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
  return (
    <Text role="status" style={[type.caption, { color }]}>
      {STATUS_TEXT[status]}
      {when}
      {status === "error" && error ? `: ${error}` : ""}
    </Text>
  );
}

/** Sign in with an emailed code, see sync status, sign out, delete account. */
export function AccountPanel({ onSignedIn }: { onSignedIn?: () => void }) {
  const t = useTheme();
  const { status, email: signedInEmail } = useSync();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!syncConfigured) {
    return (
      <Card>
        <Text style={[type.body, { color: t.text2 }]}>Sync isn't set up in this build. Your plan is saved on this device.</Text>
      </Card>
    );
  }

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error)?.message || "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  };

  if (signedInEmail) {
    return (
      <Card style={{ gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Text style={[type.caption, { color: t.text3 }]}>Signed in as</Text>
          <Text style={[type.heading, { color: t.text }]}>{signedInEmail}</Text>
          <SyncStatusLine />
        </View>
        <Text style={[type.caption, { color: t.text2 }]}>
          Your plan and check-ins sync to your account, so they're the same on every device you sign in on. Only you can see them.
        </Text>
        <View style={styles.row}>
          <Button title="Sync now" disabled={busy || status === "syncing"} onPress={() => void run(syncNow)} />
          <Button
            title="Sign out"
            disabled={busy}
            onPress={async () => {
              if (await confirm("Sign out?", "Your plan stays on this device. Sign in again any time to keep syncing.", "Sign out")) void run(() => signOut(false));
            }}
          />
        </View>
        <View style={[styles.danger, { borderColor: t.border }]}>
          <Text style={[type.label, { color: t.text }]}>Delete account</Text>
          <Text style={[type.caption, { color: t.text3 }]}>
            Permanently deletes your account and everything synced to it. The copy on this device stays unless you start from scratch.
          </Text>
          <Button
            title="Delete my account"
            tone="danger"
            disabled={busy}
            style={{ alignSelf: "flex-start" }}
            onPress={async () => {
              if (await confirm("Delete your account?", `This permanently deletes ${signedInEmail} and all synced data. It can't be undone.`, "Delete account"))
                void run(() => deleteAccount(false), "Your account and synced data were deleted.");
            }}
          />
        </View>
        {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
      </Card>
    );
  }

  return (
    <Card style={{ gap: space.md }}>
      <Text style={[type.body, { color: t.text2 }]}>
        Sign in to back up your plan and use it on all your devices. We'll email you a 6-digit code; no password needed.
      </Text>
      {!sent ? (
        <View style={styles.row}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <TextField label="Email" placeholder="you@example.com" value={email} onChange={setEmail} />
          </View>
          <Button
            title="Email me a code"
            tone="primary"
            disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}
            onPress={() => void run(async () => { await sendCode(email.trim()); setSent(true); })}
          />
        </View>
      ) : (
        <>
          <Text style={[type.caption, { color: t.text2 }]}>We sent a code to {email.trim()}. It can take a minute to arrive.</Text>
          <View style={styles.row}>
            <View style={{ width: 160 }}>
              <TextField label="6-digit code" placeholder="123456" value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} />
            </View>
            <Button
              title="Sign in"
              tone="primary"
              disabled={busy || code.length !== 6}
              onPress={() => void run(async () => { await verifyCode(email.trim(), code); onSignedIn?.(); })}
            />
            <Button title="Use a different email" tone="ghost" onPress={() => { setSent(false); setCode(""); setMsg(null); }} />
          </View>
        </>
      )}
      {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  danger: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md, gap: space.sm, borderRadius: radius.sm },
});
