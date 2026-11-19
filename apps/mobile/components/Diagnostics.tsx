/** Settings → Backup & restore → Diagnostics: see the report, copy it, or send it to Coastwise. */
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { buildReport, copyText, reportText, sendReport, type Report } from "../lib/diagnostics";
import { useSync } from "../lib/sync";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, TextField } from "./form";

export function Diagnostics() {
  const t = useTheme();
  const signedIn = useSync((s) => s.status !== "off" && s.status !== "signedOut");
  const [r, setR] = useState<Report | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const fresh = async () => {
    const x = await buildReport();
    setR(x);
    return x;
  };
  const copy = async () => {
    const x = await fresh();
    setMsg((await copyText(reportText(x))) ? { ok: true, text: "Copied. Paste it wherever you're asking for help." } : { ok: false, text: "Couldn't copy here: select the text above and copy it." });
  };
  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await sendReport(await fresh(), note);
      setNote("");
      setMsg({ ok: true, text: "Sent. Thanks: it's saved with your account for Coastwise to look at." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't send it." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ paddingVertical: space.sm, gap: space.md }}>
      <Text style={[type.body, { color: t.text2 }]}>
        Something not working? This tells Coastwise what's going on: the app's version, your device, how much is saved, and how sync is doing. No amounts, names or transactions.
      </Text>
      {r ? (
        <Text selectable style={[type.caption, { color: t.text2, backgroundColor: t.surface2, borderRadius: radius.sm, padding: space.sm, fontFamily: Platform.OS === "web" ? "ui-monospace, Menlo, Consolas, monospace" : undefined }]}>
          {reportText(r)}
        </Text>
      ) : null}
      {signedIn ? <TextField label="What happened? (optional)" value={note} onChange={setNote} placeholder="For example: the update stopped at 500 of 6,000" /> : null}
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        {signedIn ? <Button title={busy ? "Sending…" : "Send to Coastwise"} tone="primary" disabled={busy} onPress={() => void send()} /> : null}
        <Button title="Copy" onPress={() => void copy()} />
        {r ? null : <Button title="Show it" tone="ghost" onPress={() => void fresh()} />}
      </View>
      {signedIn ? null : <Text style={[type.caption, { color: t.text3 }]}>Sign in to send it; you can always copy it.</Text>}
      {msg ? <Text role="status" style={[type.label, { color: msg.ok ? t.good : t.bad }]}>{msg.text}</Text> : null}
    </View>
  );
}
