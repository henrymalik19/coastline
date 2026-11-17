import { Linking, Text, View } from "react-native";
import { radius, type, useTheme } from "../lib/theme";

export const FEEDBACK_EMAIL = "feedback@getcoastwise.com";
export const sendFeedback = () => void Linking.openURL(`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Coastwise feedback")}`).catch(() => undefined);

/** Small "Beta" tag shown next to the Coastwise name while the app is in beta. */
export function BetaTag() {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.accentSoft, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "center" }}>
      <Text style={[type.caption, { color: t.accent, fontWeight: "800", letterSpacing: 0.5 }]}>BETA</Text>
    </View>
  );
}

/** One line for the welcome screens: what "beta" means, and where feedback goes. */
export function BetaNote() {
  const t = useTheme();
  return (
    <Text style={[type.caption, { color: t.text3 }]}>
      Coastwise is in beta: it's free while in beta, things may still change, and your feedback shapes what comes next.{" "}
      <Text role="link" style={{ color: t.accent, fontWeight: "700" }} onPress={sendFeedback}>
        Send feedback
      </Text>
    </Text>
  );
}
