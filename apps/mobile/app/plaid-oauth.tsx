/**
 * Back from a bank's own sign-in page (banks like Chase use OAuth: you sign in on their site, then they
 * send you here). Plaid's window reopens where it left off, the connection is saved, and you land on
 * Settings → Accounts. This address is PLAID_REDIRECT_URI and must be in Plaid's Allowed redirect URIs.
 */
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/form";
import { Card } from "../components/ui";
import { resumeBankLink, usePlaid } from "../lib/plaid";
import { useStore } from "../lib/store";
import { useSync } from "../lib/sync";
import { space, type, useTheme } from "../lib/theme";

export default function PlaidOAuth() {
  const t = useTheme();
  const router = useRouter();
  const hydrated = useStore((s) => s.hydrated);
  const planId = useSync((s) => s.planId);
  const status = useSync((s) => s.status);
  const error = usePlaid((s) => s.error);
  const [state, setState] = useState<"waiting" | "working" | "nothing" | "done">("waiting");
  const started = useRef(false);

  useEffect(() => {
    // wait for this device's plan and the sign-in (the link is finished with your session)
    if (started.current || !hydrated || !planId || Platform.OS !== "web") return;
    started.current = true;
    setState("working");
    void resumeBankLink(window.location.href).then((ok) => {
      if (!ok) return setState("nothing");
      setState("done");
      if (!usePlaid.getState().error) router.replace("/settings/accounts");
    });
  }, [hydrated, planId, router]);

  const signedOut = hydrated && status === "signedOut";
  const back = () => router.replace("/settings/accounts");

  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      <Card style={styles.card}>
        {signedOut ? (
          <>
            <Text style={[type.heading, { color: t.text, textAlign: "center" }]}>Sign in to finish</Text>
            <Text style={[type.body, { color: t.text2, textAlign: "center" }]}>Connecting a bank uses your Coastwise account. Sign in, then connect the bank again.</Text>
            <Button title="Sign in" tone="primary" onPress={() => router.replace("/sign-in")} />
          </>
        ) : state === "nothing" ? (
          <>
            <Text style={[type.heading, { color: t.text, textAlign: "center" }]}>Nothing to finish here</Text>
            <Text style={[type.body, { color: t.text2, textAlign: "center" }]}>This page finishes connecting a bank. Start again from Settings → Accounts.</Text>
            <Button title="Go to Accounts" tone="primary" onPress={back} />
          </>
        ) : state === "done" && error ? (
          <>
            <Text style={[type.heading, { color: t.text, textAlign: "center" }]}>The bank didn't connect</Text>
            <Text role="alert" style={[type.body, { color: t.bad, textAlign: "center" }]}>{error}</Text>
            <Button title="Go to Accounts" tone="primary" onPress={back} />
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={t.accent} />
            <Text role="status" style={[type.heading, { color: t.text, textAlign: "center" }]}>Finishing your bank connection…</Text>
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 420, alignItems: "center", gap: space.md, paddingVertical: space.xl },
});
