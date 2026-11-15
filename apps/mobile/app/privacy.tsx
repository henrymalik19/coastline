import { useRouter } from "expo-router";
import { Linking, Text, View } from "react-native";
import { Card, Screen } from "../components/ui";
import { space, type, useTheme } from "../lib/theme";

/** Contact for privacy questions and requests (forwarded to the owner). */
const PRIVACY_EMAIL = "privacy@getcoastwise.com";
const UPDATED = "November 14, 2026";

type Part = { h: string; p: (string | { b: string[] })[] };

const PARTS: Part[] = [
  {
    h: "The short version",
    p: [
      "Coastwise is a budgeting and retirement planner. We use your information only to show you your own plan. We don't sell it, we don't show ads, and we never move your money.",
    ],
  },
  {
    h: "What we collect",
    p: [
      {
        b: [
          "Your email address, if you create an account. It's how you sign in (we email you a code).",
          "The plan you enter: income, budget, accounts and balances, debts, property, goals, transactions you add or import, and your settings.",
          "If you connect a bank through Plaid: the names, types and last 4 digits of your accounts, their balances and credit limits, card and loan rates and minimum payments, and transactions when the app imports them.",
        ],
      },
      "If you use Coastwise without an account, your plan stays on your device and we don't receive it.",
    ],
  },
  {
    h: "Bank connections (Plaid)",
    p: [
      "We use Plaid to connect to your bank. You sign in to your bank in Plaid's window, never in Coastwise, so we never see your bank password. Coastwise can only read your information; it can't make payments or transfers.",
      "Plaid's handling of your information is described in the Plaid End User Privacy Policy (plaid.com/legal). You can disconnect a bank at any time on the Money tab, which also ends our access at Plaid.",
    ],
  },
  {
    h: "How we use it",
    p: [
      {
        b: [
          "To show you your budget, accounts and retirement plan, and keep them in sync across your devices.",
          "To send the emails you ask for, like sign-in codes.",
          "To keep the service secure and working.",
        ],
      },
    ],
  },
  {
    h: "Who we share it with",
    p: [
      "We don't sell or rent your information, and we don't share it for advertising. It's shared only:",
      {
        b: [
          "With the people you choose, if you share your plan with a spouse or partner.",
          "With the services that run Coastwise for us: Supabase (database and sign-in, in the US), Vercel (hosting the app), Resend (sign-in emails) and Plaid (bank connections). They may use it only to provide their service.",
          "If the law requires it.",
        ],
      },
    ],
  },
  {
    h: "How we protect it",
    p: [
      "Everything travels over encrypted connections (HTTPS). Data is encrypted where it's stored, and bank access tokens are encrypted again by the app. Each person can only read their own plan and the plans shared with them; the database enforces this. Only the owner of Coastwise can reach the systems that store data, and those accounts use two-step sign-in.",
    ],
  },
  {
    h: "Keeping and deleting your information",
    p: [
      "We keep your information while you have an account. You can download a backup at any time (Settings → Backup & restore).",
      "Deleting your account (Settings → Account & sync) disconnects your banks at Plaid and permanently deletes your account and everything synced to it. Copies in our providers' routine backups are gone within 30 days.",
      "You can also ask us to see, correct or delete your information by emailing us; we'll answer within 30 days.",
    ],
  },
  {
    h: "Children",
    p: ["Coastwise is for adults. It isn't meant for anyone under 18, and we don't knowingly collect information from children."],
  },
  {
    h: "Changes",
    p: ["If we change this policy, we'll update the date below and, for important changes, tell you in the app."],
  },
];

/** Privacy policy: plain words, public (no sign-in). */
export default function Privacy() {
  const t = useTheme();
  const router = useRouter();
  const body = [type.body, { color: t.text2 }];
  return (
    <Screen title="Privacy policy" subtitle={`Last updated ${UPDATED}`} narrow hideSettings back={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
      <Card style={{ gap: space.lg }}>
        {PARTS.map((part) => (
          <View key={part.h} style={{ gap: space.sm }}>
            <Text role="heading" aria-level={2} style={[type.heading, { color: t.text }]}>{part.h}</Text>
            {part.p.map((x, i) =>
              typeof x === "string" ? (
                <Text key={i} style={body}>{x}</Text>
              ) : (
                <View key={i} style={{ gap: space.xs }}>
                  {x.b.map((line) => (
                    <View key={line} style={{ flexDirection: "row", gap: space.sm }}>
                      <Text style={body}>•</Text>
                      <Text style={[...body, { flex: 1 }]}>{line}</Text>
                    </View>
                  ))}
                </View>
              ),
            )}
          </View>
        ))}
        <View style={{ gap: space.sm }}>
          <Text role="heading" aria-level={2} style={[type.heading, { color: t.text }]}>Contact</Text>
          <Text style={body}>
            Questions or requests:{" "}
            <Text role="link" style={{ color: t.accent, fontWeight: "600" }} onPress={() => void Linking.openURL(`mailto:${PRIVACY_EMAIL}`)}>
              {PRIVACY_EMAIL}
            </Text>
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
