import { run } from "@coastfi/engine";
import { defaultPlanState } from "@coastfi/schema";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Phase 0 smoke screen: proves the engine runs in the app. Real dashboard is Phase 2. */
export default function Home() {
  const result = useMemo(() => {
    const s = defaultPlanState();
    s.age = 32;
    s.budget = [{ id: "b1", name: "Living costs", amount: 3500, inRetirement: true }];
    s.accounts = [{ id: "a1", name: "401(k)", type: "pretax", balance: 50000 }];
    s.incomes = [{ id: "i1", name: "Job", freq: "biweekly", net: 2400, matchMode: "usd", pretax: 200, match: 100 }];
    // The UI injects the date; the engine never reads the clock.
    return run(s, new Date());
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>Coast FI</Text>
      <Text style={styles.note}>Demo numbers: today's dollars, 5% real return.</Text>
      <View style={styles.card}>
        <Row label="FIRE number" value={usd(result.fire)} />
        <Row label="Coast number today" value={usd(result.coastNow)} />
        <Row label="Progress to Coast FI" value={`${Math.round(result.progress * 100)}%`} />
        <Row label="Coast date" value={result.crossing === null ? "Not before retirement" : `in ${result.crossing.toFixed(1)} years`} />
        <Row label="Odds of FIRE by retire age" value={`${Math.round(result.mc.probFire * 100)}%`} />
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  title: { fontSize: 28, fontWeight: "700" },
  note: { color: "#666" },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "#ccc", padding: 16, gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  label: { color: "#444" },
  value: { fontWeight: "600", fontVariant: ["tabular-nums"] },
});
