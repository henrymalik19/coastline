import { Redirect, useRouter } from "expo-router";
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop, Text as SvgText } from "react-native-svg";
import { Button } from "../components/form";
import { Icon, type IconName } from "../components/Icon";
import { Card } from "../components/ui";
import { useStore } from "../lib/store";
import { syncConfigured } from "../lib/supabase";
import { radius, space, type, useTheme } from "../lib/theme";

/**
 * Landing page. Finished setup → Home. Otherwise a short intro with two ways in:
 * start a new plan, or sign in to load one. Waits for saved data to load.
 */
export default function Index() {
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  if (!hydrated) return null;
  if (onboarded) return <Redirect href="/home" />;
  return <Landing />;
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "target", title: "Find your Coast FI number", body: "See how much you need invested today for growth alone to carry you to retirement." },
  { icon: "plan", title: "A plan for every dollar", body: "A step-by-step order for your money: emergency fund, match, debts, IRA, 401(k) and goals." },
  { icon: "calendar", title: "Check in once a month", body: "Log your balances in a minute and see whether you're ahead of or behind the plan." },
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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl, paddingHorizontal: gutter, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: 1080, gap: wide ? 56 : space.xxl }}>
        {/* top bar */}
        <View style={styles.bar}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Wave color={t.accent} />
            <Text style={[type.heading, { color: t.text, fontWeight: "700" }]}>Coastline</Text>
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
              Know when you can coast.
            </Text>
            <Text style={[styles.lede, { color: t.text2 }]}>
              Coastline shows when the money you've already invested can grow into your full retirement on its own, so you'd only need to earn enough to
              cover today's bills. Then it gives you a plan to get there.
            </Text>
            <View style={styles.ctas}>
              <Button title="Get started" tone="primary" onPress={start} style={styles.cta} />
              {syncConfigured ? <Button title="I already have an account" onPress={signIn} style={styles.cta} /> : null}
            </View>
            <Text style={[type.caption, { color: t.text3 }]}>
              {syncConfigured
                ? "Setup takes about 5 minutes. No account needed to start; sign in later to use your plan on every device."
                : "Setup takes about 5 minutes. Your data stays on this device."}
            </Text>
          </View>
          <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : "100%" }}>
            <Card padded={false} style={{ overflow: "hidden" }}>
              <Hero />
            </Card>
          </View>
        </View>

        {/* features */}
        <View style={[styles.features, { flexDirection: wide ? "row" : "column" }]}>
          {FEATURES.map((f) => (
            <Card key={f.title} style={{ flex: wide ? 1 : undefined, gap: space.sm }}>
              <View style={[styles.featureIcon, { backgroundColor: t.accentSoft }]}>
                <Icon name={f.icon} size={20} color={t.accent} />
              </View>
              <Text role="heading" aria-level={2} style={[type.heading, { color: t.text }]}>{f.title}</Text>
              <Text style={[type.body, { color: t.text2 }]}>{f.body}</Text>
            </Card>
          ))}
        </View>

        <View style={{ alignItems: "center", gap: space.md }}>
          <Text style={[type.title, { color: t.text, textAlign: "center" }]}>Ready to see your number?</Text>
          <Button title="Get started" tone="primary" onPress={start} style={styles.cta} />
          <Text style={[type.caption, { color: t.text3, textAlign: "center" }]}>
            Estimates in today's dollars, for planning only. Not financial advice.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

/** Small brand mark: two waves. */
function Wave({ color }: { color: string }) {
  return (
    <View aria-hidden style={{ width: 26, height: 26 }}>
      <Svg width={26} height={26} viewBox="0 0 24 24">
        <Path d="M2 10c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5-1" stroke={color} strokeWidth={2.2} strokeLinecap="round" fill="none" />
        <Path d="M2 16c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5-1" stroke={color} strokeWidth={2.2} strokeLinecap="round" fill="none" opacity={0.5} />
      </Svg>
    </View>
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
  features: { gap: space.lg },
  featureIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
