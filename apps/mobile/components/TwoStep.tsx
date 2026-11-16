import { useEffect, useState } from "react";
import { Image, Linking, Platform, StyleSheet, Text, View } from "react-native";
import { confirm } from "../lib/confirm";
import { authenticatorApp, finishAuthenticator, removeAuthenticator, startAuthenticator, type Enrolling } from "../lib/mfa";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, TextField } from "./form";

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

/** Account settings: turn two-step sign-in (an authenticator app) on or off. */
export function TwoStepSettings() {
  const t = useTheme();
  // undefined while loading, null when off
  const [app, setApp] = useState<{ id: string } | null | undefined>(undefined);
  const [setup, setSetup] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    authenticatorApp().then((a) => setApp(a ?? null), () => setApp(null));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error)?.message || "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () =>
    void run(async () => {
      const s = setup;
      setSetup(null);
      setCode("");
      if (s) await removeAuthenticator(s.factorId).catch(() => undefined);
    });

  return (
    <View style={[styles.section, { borderColor: t.border }]}>
      <Text style={[type.label, { color: t.text }]}>Two-step sign-in</Text>
      {app === undefined ? (
        <Text style={[type.caption, { color: t.text3 }]}>Checking…</Text>
      ) : app ? (
        <>
          <Text style={[type.caption, { color: t.good, fontWeight: "700" }]}>On</Text>
          <Text style={[type.caption, { color: t.text3 }]}>Signing in needs your password (or an emailed code) plus a code from your authenticator app.</Text>
          <Button
            title="Turn off"
            disabled={busy}
            style={{ alignSelf: "flex-start" }}
            onPress={async () => {
              if (await confirm("Turn off two-step sign-in?", "Signing in will need only your password or the code we email you.", "Turn off"))
                void run(async () => {
                  await removeAuthenticator(app.id);
                  setApp(null);
                  setMsg({ ok: true, text: "Two-step sign-in is off." });
                });
            }}
          />
        </>
      ) : setup ? (
        <>
          <Text style={[type.caption, { color: t.text2 }]}>
            1. In your authenticator app (like Google Authenticator, 1Password or Aegis), add an account
            {Platform.OS === "web" ? " by scanning this code." : "."}
          </Text>
          {Platform.OS === "web" ? (
            <View style={[styles.qr, { borderColor: t.border }]}>
              <Image source={{ uri: setup.qr }} style={{ width: 180, height: 180 }} accessibilityLabel="QR code for your authenticator app" />
            </View>
          ) : (
            <Button title="Open in my authenticator app" style={{ alignSelf: "flex-start" }} onPress={() => void Linking.openURL(setup.uri).catch(() => undefined)} />
          )}
          <Text style={[type.caption, { color: t.text3 }]}>Or type in this key:</Text>
          <Text selectable style={[type.label, styles.key, { color: t.text, backgroundColor: t.surface2 }]}>
            {setup.secret.match(/.{1,4}/g)?.join(" ")}
          </Text>
          <Text style={[type.caption, { color: t.text3 }]}>Save the key in your password manager too: it's how you get back in if you lose your phone.</Text>
          <Text style={[type.caption, { color: t.text2 }]}>2. Enter the 6-digit code the app shows.</Text>
          <View style={styles.row}>
            <View style={{ width: 160 }}>
              <TextField label="6-digit code" placeholder="123456" value={code} onChange={(v) => setCode(digits(v))} />
            </View>
            <Button
              title="Turn on"
              tone="primary"
              disabled={busy || code.length !== 6}
              onPress={() =>
                void run(async () => {
                  await finishAuthenticator(setup.factorId, code);
                  setApp({ id: setup.factorId });
                  setSetup(null);
                  setCode("");
                  setMsg({ ok: true, text: "Two-step sign-in is on." });
                })
              }
            />
            <Button title="Cancel" tone="ghost" disabled={busy} onPress={cancel} />
          </View>
        </>
      ) : (
        <>
          <Text style={[type.caption, { color: t.text3 }]}>
            Off. Add an authenticator app so signing in also needs a code from your phone. Then someone who learns your password or gets into your email still can't sign in.
          </Text>
          <Button
            title="Set up"
            disabled={busy}
            style={{ alignSelf: "flex-start" }}
            onPress={() => void run(async () => setSetup(await startAuthenticator()))}
          />
        </>
      )}
      {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  qr: { alignSelf: "flex-start", padding: space.sm, borderWidth: 1, borderRadius: radius.md, backgroundColor: "#fff" },
  key: { alignSelf: "flex-start", fontFamily: Platform.select({ web: "ui-monospace, Menlo, Consolas, monospace", ios: "Menlo", default: "monospace" }), paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.sm, letterSpacing: 1 },
});
