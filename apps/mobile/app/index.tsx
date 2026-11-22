import { Redirect, useRouter } from "expo-router";
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop, Text as SvgText } from "react-native-svg";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/form";
import { BetaNote, BetaTag } from "../components/Beta";
import { Icon, type IconName } from "../components/Icon";
import { Card } from "../components/ui";
import { useMembership } from "../lib/sharing";
import { useStore } from "../lib/store";
import { BANKS_PUBLIC } from "../lib/features";
import { syncConfigured } from "../lib/supabase";
import { radius, space, type, useTheme } from "../lib/theme";

/**
 * Landing page. Finished setup → Home. Otherwise a short intro with two ways in:
 * start a new plan, or sign in to load one. Waits for saved data to load.
 */
export default function Index() {
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  const member = useMembership((s) => s.status);
  if (!hydrated) return null;
  if (onboarded) return <Redirect href="/home" />;
  // someone invited to another plan: their shared budget
  if (member === "member") return <Redirect href="/shared" />;
  return <Landing />;
}

const FEATURES: { icon: IconName; title: string; body: string; banks?: true }[] = [
  { icon: "wallet", title: "An envelope budget", body: "Give every dollar a job before you spend it, track spending by category, and carry what's left into next month." },
  { icon: "target", title: "Your Coast FI number", body: "See how much you need invested today for growth alone to carry you to retirement, and the year you get there." },
  { icon: "plan", title: "A plan for what's left", body: "A step-by-step order for extra money: emergency fund, employer match, debts, IRA, 401(k) and your goals." },
  { icon: "database", title: "Switching from YNAB?", body: "Bring your accounts, categories and transactions over in a few minutes. You check everything before it comes in." },
  { icon: "card", title: "Balances that keep up", body: "Connect your bank, cards and retirement accounts, and balances update on their own. Coastwise can only read them.", banks: true },
  { icon: "user", title: "Plan together", body: "Share your budget and plan with a spouse or partner, with the access you choose." },
];

const STEPS: { title: string; body: string }[] = [
  { title: "Set up in about 5 minutes", body: "Add your income, accounts and goals, or bring them over from YNAB." },
  { title: "Budget each month", body: "Assign this month's money to categories and log spending as you go." },
  { title: "Watch your coast date", body: "Check in once a month to see whether you're ahead or behind, and what to do next." },
];

function Landing() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 860;
  const gutter = width >= 1024 ? 40 : width >= 600 ? 24 : 16;
  const start = () => router.push("/onboarding");
  const signIn = () => router.push("/sign-in");
  const features = FEATURES.filter((f) => !f.banks || BANKS_PUBLIC);
  const heading2 = [type.title, { color: t.text, textAlign: wide ? ("center" as const) : undefined }];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl, paddingHorizontal: gutter, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: 1080, gap: wide ? 64 : 40 }}>
        {/* top bar */}
        <View style={styles.bar}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <BrandMark size={32} />
            <Text style={[type.heading, { color: t.text, fontWeight: "700" }]}>Coastwise</Text>
            <BetaTag />
          </View>
          {syncConfigured ? (
            <Pressable role="link" onPress={signIn} hitSlop={8} style={{ paddingVertical: 6, paddingHorizontal: 4 }}>
              <Text style={[type.label, { color: t.accent, fontWeight: "600" }]}>Sign in</Text>
            </Pressable>
          ) : null}
        </View>

        {/* hero */}
        <View style={[styles.hero, { flexDirection: wide ? "row" : "column" }]}>
          <View style={{ flex: wide ? 1 : undefined, gap: space.lg }}>
            <Text role="heading" aria-level={1} style={[styles.headline, { color: t.text, fontSize: wide ? 48 : 36, lineHeight: wide ? 54 : 42 }]}>
              Budget today.{"\n"}Coast tomorrow.
            </Text>
            <Text style={[styles.lede, { color: t.text2 }]}>
              Coastwise is an envelope budget and a retirement plan in one. Give every dollar a job, see the year your investments can carry your
              retirement on their own, and know what to do with your money next.
            </Text>
            <View style={styles.ctas}>
              <Button title="Get started" tone="primary" onPress={start} style={styles.cta} />
              {syncConfigured ? <Button title="I already have an account" onPress={signIn} style={styles.cta} /> : null}
            </View>
            <Text style={[type.caption, { color: t.text3 }]}>
              {syncConfigured ? "No account needed to start. Sign in later to use your plan on every device." : "Your data stays on this device."}
            </Text>
            <BetaNote />
          </View>
          <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : "100%" }}>
            <Card padded={false} style={{ overflow: "hidden" }}>
              <Hero />
            </Card>
          </View>
        </View>

        {/* features */}
        <View style={{ gap: space.lg }}>
          <Text role="heading" aria-level={2} style={heading2}>Everything your money needs, in one place</Text>
          <View style={styles.grid}>
            {features.map((f) => (
              <Card key={f.title} style={{ flexBasis: wide ? "30%" : width >= 600 ? "45%" : "100%", flexGrow: 1, gap: space.sm }}>
                <View style={[styles.featureIcon, { backgroundColor: t.accentSoft }]}>
                  <Icon name={f.icon} size={20} color={t.accent} />
                </View>
                <Text role="heading" aria-level={3} style={[type.heading, { color: t.text }]}>{f.title}</Text>
                <Text style={[type.body, { color: t.text2 }]}>{f.body}</Text>
              </Card>
            ))}
          </View>
        </View>

        {/* how it works */}
        <View style={{ gap: space.lg }}>
          <Text role="heading" aria-level={2} style={heading2}>How it works</Text>
          <View style={[styles.steps, { flexDirection: wide ? "row" : "column" }]}>
            {STEPS.map((s, i) => (
              <View key={s.title} style={[styles.step, { flex: wide ? 1 : undefined }]}>
                <View style={[styles.stepNum, { backgroundColor: t.accentSoft }]}>
                  <Text style={[type.label, { color: t.accent, fontWeight: "800" }]}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.body, { color: t.text, fontWeight: "700" }]}>{s.title}</Text>
                  <Text style={[type.body, { color: t.text2 }]}>{s.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* privacy */}
        <Card style={{ ...styles.trust, flexDirection: wide ? "row" : "column" }}>
          <View style={[styles.featureIcon, { backgroundColor: t.accentSoft }]}>
            <Icon name="lock" size={20} color={t.accent} />
          </View>
          <View style={{ flex: wide ? 1 : undefined, gap: space.xs }}>
            <Text role="heading" aria-level={2} style={[type.heading, { color: t.text }]}>Private by default</Text>
            <Text style={[type.body, { color: t.text2 }]}>
              Start without an account and your plan stays on this device. Sign in only when you want it everywhere. We never sell your data or show
              ads, and Coastwise can't move your money.{" "}
              <Text role="link" style={{ color: t.accent, fontWeight: "600" }} onPress={() => router.push("/privacy")}>Read the privacy policy</Text>
            </Text>
          </View>
        </Card>

        {/* closing */}
        <View style={{ alignItems: "center", gap: space.md }}>
          <Text role="heading" aria-level={2} style={[type.title, { color: t.text, textAlign: "center" }]}>Ready to see your number?</Text>
          <Button title="Get started" tone="primary" onPress={start} style={styles.cta} />
          <Text style={[type.caption, { color: t.text3, textAlign: "center" }]}>
            Estimates in today's dollars, for planning only. Not financial advice.
          </Text>
          <Pressable role="link" onPress={() => router.push("/privacy")} hitSlop={8}>
            <Text style={[type.caption, { color: t.text3, textDecorationLine: "underline" }]}>Privacy policy</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

/** Decorative picture: savings grow until they cross the Coast FI line, then coast. */
function Hero() {
  const t = useTheme();
  const font = Platform.OS === "web" ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : undefined;
  return (
    <View aria-hidden importantForAccessibility="no-hide-descendants" style={{ width: "100%", aspectRatio: 480 / 300 }}>
      <Svg width="100%" height="100%" viewBox="0 0 480 300" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.accentSoft} stopOpacity={0.9} />
            <Stop offset="1" stopColor={t.surface} stopOpacity={1} />
          </LinearGradient>
          <LinearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.accent} stopOpacity={0.28} />
            <Stop offset="1" stopColor={t.accent} stopOpacity={0.08} />
          </LinearGradient>
        </Defs>
        <Path d="M0 0H480V300H0Z" fill="url(#sky)" />
        {/* Coast FI line */}
        <Line x1="32" y1="118" x2="456" y2="118" stroke={t.text3} strokeWidth={1.5} strokeDasharray="5 6" />
        <SvgText x="40" y="108" fill={t.text2} fontSize={13} fontWeight="600" fontFamily={font}>Coast FI number</SvgText>
        {/* growth: steep while saving, then a gentle coast */}
        <Path d="M32 236 C 110 230, 170 200, 236 118 S 380 70, 456 52" stroke={t.accent} strokeWidth={3} strokeLinecap="round" fill="none" />
        <Circle cx="236" cy="118" r="9" fill={t.surface} />
        <Circle cx="236" cy="118" r="6" fill={t.accent} />
        <SvgText x="252" y="146" fill={t.text} fontSize={13} fontWeight="700" fontFamily={font}>You can coast from here</SvgText>
        {/* sea */}
        <Path d="M0 262 C 40 250, 80 250, 120 262 S 200 274, 240 262 S 320 250, 360 262 S 440 274, 480 262 V300 H0Z" fill="url(#sea)" />
        <Path d="M0 276 C 40 266, 80 266, 120 276 S 200 286, 240 276 S 320 266, 360 276 S 440 286, 480 276 V300 H0Z" fill={t.accent} opacity={0.14} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hero: { gap: 40, alignItems: "center" },
  headline: { fontWeight: "800", letterSpacing: -1 },
  lede: { fontSize: 17, lineHeight: 26 },
  ctas: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  cta: { paddingHorizontal: space.xl, minHeight: 46 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.lg },
  steps: { gap: space.lg },
  step: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  stepNum: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  trust: { gap: space.md, alignItems: "flex-start" },
  featureIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
