import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { AccountPanel } from "../components/AccountPanel";
import { Button } from "../components/form";
import { Card, Screen } from "../components/ui";
import { useStore } from "../lib/store";
import { useSync } from "../lib/sync";
import { useMembership } from "../lib/sharing";
import { space, type, useTheme } from "../lib/theme";

/** Returning users: sign in with an emailed code and load the plan from the account. */
export default function SignIn() {
  const t = useTheme();
  const router = useRouter();
  const onboarded = useStore((s) => s.onboarded);
  const { email, status, choosingPassword } = useSync();
  const member = useMembership((s) => s.status);

  // once the account's plan arrives (or this device already has one), go to it; someone invited to
  // another plan goes to their shared budget. After "Forgot password?", Account comes first to set a new one.
  useEffect(() => {
    if (onboarded) router.replace(email && choosingPassword ? "/settings/account" : "/home");
    else if (member === "member") router.replace("/shared");
  }, [onboarded, member, router, email, choosingPassword]);

  const loading = !!email && (status === "syncing" || status === "signedOut" || member === "unknown");
  const noPlan = !!email && !onboarded && member === "none" && (status === "synced" || status === "offline" || status === "error");

  return (
    <Screen title="Sign in" subtitle="Load your plan from your Coastwise account" narrow hideSettings back={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
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
          New to Coastwise?{" "}
          <Text role="link" style={{ color: t.accent, fontWeight: "700" }} onPress={() => router.replace("/onboarding")}>
            Set up a plan
          </Text>{" "}
          — no account needed to start.
        </Text>
      ) : null}
    </Screen>
  );
}
