import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { confirm } from "../lib/confirm";
import {
  deleteAccount, MIN_PASSWORD, sendCode, setPassword, signInWithPassword, signOut, signOutOthers, syncNow, useSync, verifyCode, type SyncStatus,
} from "../lib/sync";
import { verifySecondStep } from "../lib/mfa";
import { syncConfigured } from "../lib/supabase";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, TextField } from "./form";
import { TwoStepSettings } from "./TwoStep";
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
  const { status, email: signedInEmail, notice, secondStep, choosingPassword } = useSync();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPasswordText] = useState("");
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
        <PasswordSettings />
        <TwoStepSettings />
        <View style={[styles.danger, { borderColor: t.border }]}>
          <Text style={[type.label, { color: t.text }]}>Other devices</Text>
          <Text style={[type.caption, { color: t.text3 }]}>
            Signed in somewhere you don't use anymore, or don't recognize? Sign out everywhere except here.
          </Text>
          <Button
            title="Sign out other devices"
            disabled={busy}
            style={{ alignSelf: "flex-start" }}
            onPress={async () => {
              if (await confirm("Sign out other devices?", "Every other device and browser will need to sign in again. This one stays signed in.", "Sign out others"))
                void run(signOutOthers, "Other devices are signed out. Anything open there loses access within the hour.");
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

  if (secondStep !== undefined) {
    return (
      <Card style={{ gap: space.md }}>
        <Text style={[type.heading, { color: t.text }]}>One more step</Text>
        <Text style={[type.body, { color: t.text2 }]}>
          {secondStep || "This account"} has two-step sign-in on. Enter the 6-digit code from your authenticator app.
        </Text>
        <View style={styles.row}>
          <View style={{ width: 160 }}>
            <TextField label="Authenticator code" placeholder="123456" value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} />
          </View>
          <Button
            title="Continue"
            tone="primary"
            disabled={busy || code.length !== 6}
            onPress={() => void run(async () => { await verifySecondStep(code); setCode(""); onSignedIn?.(); })}
          />
          <Button title="Cancel" tone="ghost" disabled={busy} onPress={() => void run(async () => { await signOut(false); setSent(false); setCode(""); })} />
        </View>
        {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
      </Card>
    );
  }

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  return (
    <Card style={{ gap: space.md }}>
      {notice ? <Text role="status" style={[type.label, { color: t.warn }]}>{notice}</Text> : null}
      <Text style={[type.body, { color: t.text2 }]}>
        Sign in to back up your plan and use it on all your devices.
      </Text>
      {!sent ? (
        <>
          <TextField label="Email" placeholder="you@example.com" value={email} onChange={setEmail} autoComplete="email" />
          <TextField label="Password" placeholder="Password" value={password} onChange={setPasswordText} secure autoComplete="current-password" />
          <Text
            role="link"
            style={[type.caption, { color: t.accent, fontWeight: "700", alignSelf: "flex-start" }]}
            onPress={() =>
              void run(async () => {
                if (!emailOk) throw new Error("Enter your email first, then tap Forgot password.");
                await sendCode(email.trim());
                useSync.setState({ choosingPassword: true });
                setSent(true);
                setPasswordText("");
              })
            }
          >
            Forgot password?
          </Text>
          <View style={styles.row}>
            <Button
              title="Sign in"
              tone="primary"
              disabled={busy || !emailOk || !password}
              onPress={() => void run(async () => { await signInWithPassword(email.trim(), password); setPasswordText(""); onSignedIn?.(); })}
            />
            <Button
              title="Email me a code"
              tone="ghost"
              disabled={busy || !emailOk}
              onPress={() => void run(async () => { useSync.setState({ choosingPassword: undefined }); await sendCode(email.trim()); setSent(true); setPasswordText(""); })}
            />
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>
            New here, or never set a password? Use Email me a code. You can set a password in Account once you're in.
          </Text>
        </>
      ) : (
        <>
          <Text style={[type.caption, { color: t.text2 }]}>
            We sent a code to {email.trim()}. It can take a minute to arrive.
            {choosingPassword ? " Enter it to sign in, then you'll set a new password." : ""}
          </Text>
          <View style={styles.row}>
            <View style={{ width: 160 }}>
              <TextField label="6-digit code" placeholder="123456" value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} />
            </View>
            <Button
              title="Sign in"
              tone="primary"
              disabled={busy || code.length !== 6}
              onPress={() => void run(async () => { await verifyCode(email.trim(), code); setSent(false); setCode(""); onSignedIn?.(); })}
            />
            <Button title="Use a different email" tone="ghost" onPress={() => { setSent(false); setCode(""); setMsg(null); useSync.setState({ choosingPassword: undefined }); }} />
          </View>
        </>
      )}
      {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
    </Card>
  );
}

/** Account settings: set or change the password used to sign in. */
function PasswordSettings() {
  const t = useTheme();
  // just signed in after "Forgot password?": start with the form open
  const resetting = useSync((s) => !!s.choosingPassword);
  const [open, setOpen] = useState(resetting);
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const close = () => { setOpen(false); setPw(""); setAgain(""); useSync.setState({ choosingPassword: undefined }); };
  const problem =
    pw.length > 0 && pw.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` : again.length > 0 && again !== pw ? "The passwords don't match." : null;
  return (
    <View style={[styles.danger, { borderColor: t.border }]}>
      <Text style={[type.label, { color: t.text }]}>{resetting ? "Set a new password" : "Password"}</Text>
      <Text style={[type.caption, { color: t.text3 }]}>
        Sign in with your email and a password instead of waiting for an emailed code. A password manager can create and remember a strong one.
      </Text>
      {open ? (
        <>
          <TextField label="New password" placeholder="New password" value={pw} onChange={setPw} secure autoComplete="new-password" />
          <TextField label="Type it again" placeholder="Type it again" value={again} onChange={setAgain} secure autoComplete="new-password" />
          {problem ? <Text style={[type.caption, { color: t.bad }]}>{problem}</Text> : null}
          <View style={styles.row}>
            <Button
              title="Save password"
              tone="primary"
              disabled={busy || pw.length < MIN_PASSWORD || again !== pw}
              onPress={() =>
                void (async () => {
                  setBusy(true);
                  setMsg(null);
                  try {
                    await setPassword(pw);
                    close();
                    setMsg({ ok: true, text: "Password saved. Use it next time you sign in." });
                  } catch (e) {
                    setMsg({ ok: false, text: (e as Error)?.message || "Couldn't save it. Try again." });
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            />
            <Button title="Cancel" tone="ghost" disabled={busy} onPress={() => { close(); setMsg(null); }} />
          </View>
        </>
      ) : (
        <Button title="Set or change password" style={{ alignSelf: "flex-start" }} onPress={() => { setOpen(true); setMsg(null); }} />
      )}
      {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  danger: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md, gap: space.sm, borderRadius: radius.sm },
});
