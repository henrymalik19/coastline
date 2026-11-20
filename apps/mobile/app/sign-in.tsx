import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AccountPanel } from "../components/AccountPanel";
import { BetaTag } from "../components/Beta";
import { Button } from "../components/form";
import { Icon } from "../components/Icon";
import { Card } from "../components/ui";
import { useStore } from "../lib/store";
import { signOut, useSync } from "../lib/sync";
import { useMembership } from "../lib/sharing";
import { radius, space, type, useTheme } from "../lib/theme";

/**
 * Returning users: sign in and load the plan from the account. One centered column (a phone's width,
 * even on a desktop), under the logo; the logo goes back to the start page. Once signed in, only a
 * loading card shows until the plan arrives, then Home.
 */
export default function SignIn() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
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
  // a big window: the column sits in the middle; a phone: near the top, clear of the keyboard
  const centered = width >= 600 && height >= 640;
  const home = () => (router.canGoBack() ? router.back() : router.replace("/"));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.page, { paddingTop: insets.top + (centered ? space.xl : space.xxl), paddingBottom: insets.bottom + space.xl, justifyContent: centered ? "center" : "flex-start" }]}
    >
      <View style={styles.column}>
        <Pressable role="link" accessibilityLabel="Coastwise: back to the start page" onPress={home} hitSlop={8} style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: t.accent }]}>
            <Icon name="trend" size={20} color="#fff" />
          </View>
          <Text style={[type.heading, { color: t.text }]}>Coastwise</Text>
          <BetaTag />
        </Pressable>

        {email ? null : (
          <View style={{ gap: 4, alignItems: "center" }}>
            <Text role="heading" style={[type.title, { color: t.text, textAlign: "center" }]}>Welcome back</Text>
            <Text style={[type.body, { color: t.text2, textAlign: "center" }]}>Sign in to load your plan.</Text>
          </View>
        )}

        {/* signed in: the account controls would look like Settings while the plan loads, so just say it is loading */}
        {email ? null : <AccountPanel intro={false} />}
        {loading ? (
          <Card style={{ alignItems: "center", gap: space.md, paddingVertical: space.xl }}>
            <ActivityIndicator size="large" color={t.accent} />
            <Text role="status" style={[type.heading, { color: t.text, textAlign: "center" }]}>Loading your plan…</Text>
            <Text style={[type.caption, { color: t.text3, textAlign: "center" }]}>Signed in as {email}</Text>
          </Card>
        ) : null}
        {noPlan ? (
          <Card style={{ gap: space.md }}>
            <Text style={[type.heading, { color: t.text }]}>No plan on this account yet</Text>
            <Text style={[type.body, { color: t.text2 }]}>
              Set one up now. When you finish, it saves to your account, so it's on every device you sign in on.
            </Text>
            <View style={{ flexDirection: "row" }}>
              <Button title="Set up my plan" tone="primary" onPress={() => router.replace("/onboarding")} />
            </View>
            <Text role="link" style={[type.caption, { color: t.accent, fontWeight: "700" }]} onPress={() => void signOut(false)}>
              Signed in as {email}. Use a different account
            </Text>
          </Card>
        ) : null}
        {!email ? (
          <Text style={[type.caption, { color: t.text3, textAlign: "center" }]}>
            New to Coastwise?{" "}
            <Text role="link" style={{ color: t.accent, fontWeight: "700" }} onPress={() => router.replace("/onboarding")}>
              Set up a plan
            </Text>
            {" "}— no account needed to start.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, alignItems: "center", paddingHorizontal: 16 },
  column: { width: "100%", maxWidth: 420, gap: space.lg },
  brand: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, alignSelf: "center" },
  logo: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
