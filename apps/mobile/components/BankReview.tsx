/**
 * Right after connecting a bank (and from "Review accounts" later): one account at a time, what is it to
 * you? A new account (cash or investments for a brokerage, a debt for a card or loan), one you already
 * have, or not used. Choices apply as you tap; the plan follows your type, never the bank's.
 */
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { applyBanks, usePlaid } from "../lib/plaid";
import { bankLabel, bankSaysCash, isDebtLike, kindDiffers, matchOf, matchOptions, newFromBank, setMatch, type BankAccount } from "../lib/plaidMatch";
import { usePlan } from "../lib/plan";
import { newId, useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { ACCOUNT_TYPES } from "./AccountsEditor";
import { Button } from "./form";
import { Icon } from "./Icon";
import { TxnStart } from "./TxnStart";

const typeLabel = (k: string) => ACCOUNT_TYPES.find((x) => x.value === k)?.label ?? k;
/** The bank's own word for the account ("Checking", "Brokerage", "Credit card"). */
const bankKind = (b: BankAccount) => {
  const s = (b.subtype ?? b.type ?? "").replace(/_/g, " ");
  return s ? s[0]!.toUpperCase() + s.slice(1) : "Account";
};

export function BankReview() {
  const t = useTheme();
  const review = usePlaid((s) => s.review);
  const items = usePlaid((s) => s.items);
  const all = usePlaid((s) => s.accounts);
  const { state } = usePlan();
  const update = useStore((s) => s.update);
  const [step, setStep] = useState(0);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    setStep(0);
    setPicking(false);
  }, [review]);
  if (!review) return null;
  const item = items.find((i) => i.id === review);
  const list = all.filter((a) => a.item === review);
  const close = () => usePlaid.setState({ review: undefined });
  if (!item || !list.length) return null;
  const b = list[Math.min(step, list.length - 1)]!;
  const company = item.institution && item.institution !== "Bank" ? item.institution : undefined;
  const debt = isDebtLike(b);
  const m = matchOf(state, b);
  const last = step >= list.length - 1;

  const pick = (to: "none" | "new" | "new-cash" | { kind: "account" | "debt"; id: string }) => {
    // unlinking: the account keeps the balance it shows now (the plan may only have yesterday's)
    if (m) applyBanks(true);
    update((p) => {
      setMatch(p, b, null);
      if (to === "none") return;
      if (to === "new" || to === "new-cash") {
        const n = newFromBank(b, newId(), company, to === "new-cash");
        if (n.kind === "debt") p.debts.push(n.debt);
        else p.accounts.push(n.account);
        return;
      }
      setMatch(p, b, to);
    });
    applyBanks();
    setPicking(false);
  };
  // what's chosen now: nothing, a match (new or existing look the same once made)
  const chosen = m ? `${m.kind}:${m.item.id}` : "none";
  const newOptions: { key: "new" | "new-cash"; label: string; hint: string }[] = debt
    ? [{ key: "new", label: "Add as a new debt", hint: "Its balance and minimum payment come from the bank" }]
    : bankSaysCash(b)
      ? [{ key: "new", label: "Add as a new account", hint: "Counts as cash" }]
      : [
          { key: "new", label: "Add as a new investment account", hint: "Counts toward your investments" },
          { key: "new-cash", label: "Add as a new cash account", hint: "If you use it like checking or savings" },
        ];
  const existing = matchOptions(state, b, company);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View role="dialog" aria-label={`Set up your ${item.institution} accounts`} style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={styles.head}>
            <Text style={[type.overline, { color: t.text3, flex: 1 }]} numberOfLines={1}>
              {item.institution} · {Math.min(step, list.length - 1) + 1} of {list.length}
            </Text>
            <Pressable role="button" accessibilityLabel="Close" onPress={close} hitSlop={10}>
              <Icon name="close" size={18} color={t.text3} />
            </Pressable>
          </View>
          <View style={[styles.acct, { backgroundColor: t.surface2 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.heading, { color: t.text }]} numberOfLines={1}>{bankLabel(b)}</Text>
              <Text style={[type.caption, { color: t.text3 }]}>{bankKind(b)}</Text>
            </View>
            <Text style={[type.heading, { color: t.text, fontVariant: ["tabular-nums"] }]}>
              {b.current == null ? "–" : `${debt ? "owe " : ""}${money(Math.max(0, b.current))}`}
            </Text>
          </View>
          <Text style={[type.label, { color: t.text2 }]}>What is this account to you?</Text>

          <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: space.sm }}>
            {!picking ? (
              <>
                {m ? (
                  <Choice on title={`Updates “${m.item.name || "your account"}”`} hint={m.kind === "account" ? typeLabel(m.item.type) : "Debt"} onPress={() => setPicking(true)} action="Change" />
                ) : null}
                {!m ? newOptions.map((o) => <Choice key={o.key} title={o.label} hint={o.hint} onPress={() => pick(o.key)} />) : null}
                {!m ? <Choice title="It's one I already have" hint={existing.length ? `${existing.length} to choose from` : "You don't have any yet"} onPress={() => setPicking(true)} chevron disabled={!existing.length} /> : null}
                {m ? <Choice title="Don't use it" hint="Stop updating it; it stays in your plan as it is" onPress={() => pick("none")} /> : <Choice title="Don't use it" hint="Leave it out of your plan" onPress={() => setStep(Math.min(step + 1, list.length - 1))} />}
                {/* a cash account or card: when its transactions start (up to 30 days back) */}
                {m && (b.type === "depository" || b.type === "credit") ? <TxnStart id={m.item.id} /> : null}
                {m?.kind === "account" && kindDiffers(m.item, b) ? (
                  <Text style={[type.caption, { color: t.text3 }]}>
                    {company ?? "The bank"} calls this {bankSaysCash(b) ? "a checking or savings account" : "an investment account"}. It counts as {m.item.type === "cash" ? "cash" : "investments"} in your plan, the way you set it.{" "}
                    <Text
                      role="button"
                      style={{ color: t.accent, fontWeight: "700" }}
                      onPress={() => update((p) => { const a = p.accounts.find((x) => x.id === m.item.id); if (a) a.type = bankSaysCash(b) ? "cash" : "taxable"; })}
                    >
                      Count it as {bankSaysCash(b) ? "cash" : "investments"} instead
                    </Text>
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                {existing.map((c, i) => (
                  <View key={c.id}>
                    {i === 0 || existing[i - 1]!.likely !== c.likely ? (
                      <Text style={[type.overline, { color: t.text3, paddingBottom: 2 }]}>{c.likely ? "Likely matches" : debt ? "Your debts" : "Your other accounts"}</Text>
                    ) : null}
                    <Choice title={c.name} hint={c.type ? typeLabel(c.type) : "Debt"} on={chosen === `${c.kind}:${c.id}`} onPress={() => pick({ kind: c.kind, id: c.id })} />
                  </View>
                ))}
                <Button title="Back" tone="ghost" onPress={() => setPicking(false)} style={{ alignSelf: "flex-start" }} />
              </>
            )}
          </ScrollView>

          <View style={styles.foot}>
            {step > 0 ? <Button title="Back" tone="ghost" onPress={() => { setStep(step - 1); setPicking(false); }} style={{ minHeight: 44 }} /> : <View />}
            <Button title={last ? "Done" : "Next"} tone="primary" onPress={() => (last ? close() : (setStep(step + 1), setPicking(false)))} style={{ minHeight: 44 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** One answer: a big row, easy to tap on a phone. */
function Choice({ title, hint, on, onPress, chevron, action, disabled }: { title: string; hint?: string; on?: boolean; onPress: () => void; chevron?: boolean; action?: string; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      role="button"
      aria-selected={!!on}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : pressed ? t.surface2 : "transparent", opacity: disabled ? 0.5 : 1 }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: t.text, fontWeight: "600" }]} numberOfLines={1}>{title}</Text>
        {hint ? <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>{hint}</Text> : null}
      </View>
      {action ? <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{action}</Text> : null}
      {on && !action ? <Icon name="check" size={16} color={t.accent} /> : null}
      {chevron ? <Icon name="chevron" size={14} color={t.text3} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // a sheet from the bottom on phones, a centered card on wide screens
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "flex-end" },
  sheet: { width: "100%", maxWidth: 480, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, padding: space.lg, paddingBottom: space.xl, gap: space.md, marginBottom: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  acct: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md },
  choice: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, minHeight: 52 },
  foot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
