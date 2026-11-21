/**
 * At the bottom of an account's or a debt's details: which bank account keeps it up to date, with
 * Unlink; or, when it isn't linked, a list of your connected bank accounts not used yet (likeliest
 * first) to link it to. Shows only once banks are connected. Your type never changes by linking.
 */
import { Text, View } from "react-native";
import { applyBanks } from "../lib/plaid";
import { usePlaid } from "../lib/plaidState";
import { bankLabel, isDebtLike, matchOf, setMatch, type BankAccount } from "../lib/plaidMatch";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { space, type, useTheme } from "../lib/theme";
import { Button, Select } from "./form";

export function BankLink({ kind, id, name, company }: { kind: "account" | "debt"; id: string; name: string; company?: string }) {
  const t = useTheme();
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const bank = usePlaid((s) => s.accounts);
  const items = usePlaid((s) => s.items);
  if (!bank.length) return null;
  const inst = (b: BankAccount) => items.find((i) => i.id === b.item)?.institution ?? "Bank";
  const mine = kind === "account" ? state.accounts.find((a) => a.id === id) : state.debts.find((d) => d.id === id);
  const linked = mine?.plaidAccountId ? bank.find((b) => b.accountId === mine.plaidAccountId) : undefined;

  if (linked)
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text style={[type.caption, { color: t.text2, flex: 1, minWidth: 0 }]} numberOfLines={2}>
          Updates from <Text style={{ color: t.text, fontWeight: "600" }}>{inst(linked)} · {bankLabel(linked)}</Text>
        </Text>
        <Button
          title="Unlink"
          tone="ghost"
          onPress={() => {
            // it keeps the balance it shows now
            applyBanks(true);
            update((p) => setMatch(p, linked, null));
          }}
          style={{ minHeight: 32 }}
        />
      </View>
    );

  // bank accounts not used yet, of the right sort (cards and loans for a debt), same bank first
  const co = (company ?? name).toLowerCase();
  const free = bank
    .filter((b) => !matchOf(state, b) && (kind === "debt") === isDebtLike(b))
    .sort((a, b) => Number(co.includes(inst(b).toLowerCase().split(" ").pop() ?? "~")) - Number(co.includes(inst(a).toLowerCase().split(" ").pop() ?? "~")));
  if (!free.length) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Text style={[type.caption, { color: t.text3, flex: 1 }]}>Not linked to a bank</Text>
      <View style={{ maxWidth: 220, flexShrink: 1 }}>
        <Select
          plain
          label={`Link ${name || "this"} to`}
          value=""
          placeholder="Link"
          options={free.map((b) => ({ value: b.accountId, label: bankLabel(b), hint: inst(b) }))}
          onChange={(v) => {
            const b = free.find((x) => x.accountId === v);
            if (!b) return;
            update((p) => setMatch(p, b, { kind, id }));
            applyBanks();
          }}
        />
      </View>
    </View>
  );
}
