import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { AccountPanel } from "../components/AccountPanel";
import { Button } from "../components/form";
import { Card, Screen } from "../components/ui";
import { useStore } from "../lib/store";
import { useSync } from "../lib/sync";
import { space, type, useTheme } from "../lib/theme";

/** Returning users: sign in with an emailed code and load the plan from the account. */
export default function SignIn() {
  const t = useTheme();
  const router = useRouter();
  const onboarded = useStore((s) => s.onboarded);
  const { email, status } = useSync();

  // once the account's plan arrives (or this device already has one), go to it
  useEffect(() => {
    if (onboarded) router.replace("/home");
  }, [onboarded, router]);

  const loading = !!email && (status === "syncing" || status === "signedOut");
  const noPlan = !!email && !onboarded && (status === "synced" || status === "offline" || status === "error");

  return (
    <Screen title="Sign in" subtitle="Load your plan from your Coastline account" narrow hideSettings back={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
      <AccountPanel />
      {loading ? <Text role="status" style={[type.body, { color: t.text2 }]}>Loading your plan…</Text> : null}
      {noPlan ? (
        <Card style={{ gap: space.md }}>
          <Text style={[type.heading, { color: t.text }]}>No plan on this account yet</Text>
          <Text style={[type.body, { color: t.text2 }]}>
            Set one up now. When you finish, it saves to your account, so it's on every device you sign in on.
          </Text>
          <View style={{ flexDirection: "row" }}>
            <Button title="Set up my plan" tone="primary" onPress={() => router.replace("/onboarding")} />
          </View>
        </Card>
      ) : null}
      {!email ? (
        <Text style={[type.caption, { color: t.text3 }]}>
          New to Coastline?{" "}
          <Text role="link" style={{ color: t.accent, fontWeight: "700" }} onPress={() => router.replace("/onboarding")}>
            Set up a plan
          </Text>{" "}
          — no account needed to start.
        </Text>
      ) : null}
    </Screen>
  );
}
