/**
 * Change one account's amount for a month, right from the forecast table: just that month, or from
 * that month on. It saves to the same monthly amounts as Budget → Set amounts (one per account), and
 * replaces anything set for that month on Your plan's steps, so there's only ever one number.
 * Paycheck accounts (the 401(k), a paycheck HSA) open each job's per-check amount instead.
 */
import { accountPlanKey, ACCOUNT_KEY, PAY401, PAYHSA, resolveIncome, scheduleAmount, type AccountKey, type PlanState, type ScheduleEntry } from "@coastfi/engine";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { money } from "../lib/format";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, NumberInput, Segmented } from "./form";
import { ChangesLater, monthName } from "./ScheduleEditor";

/** The step on Your plan that fills this account (the emergency fund's two steps fill cash). */
const stepsFor = (k: AccountKey): string[] => (k === "cash" ? ["starterEF", "fullEF"] : [k]);

/** Who sets each part of this account: its own accounts (Set amounts), or the account itself (a goal, a debt). */
export function cellTargets(s: PlanState, k: AccountKey): { key: string; name: string }[] {
  if (k.startsWith("goal:") || k.startsWith("debt:")) return [{ key: k, name: "" }];
  return (s.accounts ?? []).filter((a) => accountPlanKey(s, a) === k).map((a) => ({ key: ACCOUNT_KEY + a.id, name: a.name.trim() }));
}

/** What you set yourself for this account this month (Set amounts, or a step's amount on Your plan); undefined: the plan fills it. */
export function mineIn(s: PlanState, k: AccountKey, month: string): { amount: number; fromStep: boolean } | undefined {
  const keys = [...new Set([k as string, ...cellTargets(s, k).map((x) => x.key)])];
  const own = keys.map((x) => scheduleAmount(s.plan, x, month)).filter((v): v is number => v !== undefined);
  if (own.length) return { amount: own.reduce((a, v) => a + v, 0), fromStep: false };
  for (const st of stepsFor(k)) {
    const v = s.plan.amountsBy?.[st]?.[month] ?? s.plan.amounts?.[st];
    if (v !== undefined && v >= 0) return { amount: v, fromStep: true };
  }
  return undefined;
}

export type CellPick = { k: AccountKey; month: string; label: string; got: number; left: number; paycheck: boolean };

export function CellEditor({ pick, state, onClose }: { pick: CellPick | null; state: PlanState; onClose: () => void }) {
  return (
    <Modal visible={!!pick} transparent animationType="fade" onRequestClose={onClose}>
      {pick ? <Sheet pick={pick} state={state} onClose={onClose} /> : null}
    </Modal>
  );
}

function Sheet({ pick, state, onClose }: { pick: CellPick; state: PlanState; onClose: () => void }) {
  const t = useTheme();
  const update = useStore((s) => s.update);
  const { k, month, label } = pick;
  const mon = monthName(month).split(" ")[0]!;
  const targets = cellTargets(state, k);
  const mine = mineIn(state, k, month);
  const [vals, setVals] = useState<number[]>(() => targets.map((x) => scheduleAmount(state.plan, x.key, month) ?? (targets.length === 1 ? mine?.amount ?? pick.got : 0)));
  const [on, setOn] = useState<"month" | "on">("month");
  const total = vals.reduce((a, v) => a + (v || 0), 0);
  const leftAfter = pick.left - (total - (mine?.amount ?? 0));
  const oneOff = targets.some((x) => state.plan.scheduleMonths?.[x.key]?.[month] !== undefined);
  const startsHere = targets.some((x) => (state.plan.schedule?.[x.key] ?? []).some((e) => e.from === month));

  /** Drop what Your plan's steps had for this month (from this month on: the schedule wins anyway). */
  const clearSteps = (p: { plan: PlanState["plan"] }) => {
    for (const st of stepsFor(k)) {
      const row = p.plan.amountsBy?.[st];
      if (!row) continue;
      const next = Object.fromEntries(Object.entries(row).filter(([m]) => (on === "month" ? m !== month : m < month)));
      const all = { ...(p.plan.amountsBy ?? {}) };
      if (Object.keys(next).length) all[st] = next;
      else delete all[st];
      p.plan.amountsBy = Object.keys(all).length ? all : undefined;
    }
  };
  const save = () => {
    update((p) => {
      const months = { ...(p.plan.scheduleMonths ?? {}) };
      const sched = { ...(p.plan.schedule ?? {}) };
      targets.forEach((x, j) => {
        const v = Math.max(0, vals[j] || 0);
        const row = { ...(months[x.key] ?? {}) };
        if (on === "month") row[month] = v;
        else {
          delete row[month];
          const list: ScheduleEntry[] = (sched[x.key] ?? []).filter((e) => e.from !== month);
          list.push({ from: month, amount: v });
          sched[x.key] = list.sort((a, b) => (a.from < b.from ? -1 : 1));
        }
        if (Object.keys(row).length) months[x.key] = row;
        else delete months[x.key];
      });
      p.plan.scheduleMonths = Object.keys(months).length ? months : undefined;
      p.plan.schedule = Object.keys(sched).length ? sched : undefined;
      clearSteps(p);
    });
    onClose();
  };
  /** Undo yours for this month: the one-month change, or a change that starts this month. */
  const remove = () => {
    update((p) => {
      const months = { ...(p.plan.scheduleMonths ?? {}) };
      const sched = { ...(p.plan.schedule ?? {}) };
      for (const x of targets) {
        const row = { ...(months[x.key] ?? {}) };
        if (oneOff) delete row[month];
        if (Object.keys(row).length) months[x.key] = row;
        else delete months[x.key];
        if (!oneOff && sched[x.key]) {
          const list = sched[x.key]!.filter((e) => e.from !== month);
          if (list.length) sched[x.key] = list;
          else delete sched[x.key];
        }
      }
      p.plan.scheduleMonths = Object.keys(months).length ? months : undefined;
      p.plan.schedule = Object.keys(sched).length ? sched : undefined;
    });
    onClose();
  };

  return (
    <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
      <Pressable onPress={() => {}} aria-label={`${label}, ${monthName(month)}`} style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
        <ScrollView contentContainerStyle={{ gap: space.sm }}>
          <Text style={[type.heading, { color: t.text }]}>{label} · {monthName(month)}</Text>
          {pick.paycheck ? (
            <PaycheckParts state={state} k={k} got={pick.got} />
          ) : targets.length === 0 ? (
            <Text style={[type.body, { color: t.text2 }]}>Add an account of this kind under Money → Accounts to set an amount for it.</Text>
          ) : (
            <>
              <Text style={[type.caption, { color: t.text3 }]}>
                {mine
                  ? mine.fromStep
                    ? `Set on Your plan's steps: ${money(mine.amount)}. Saving here replaces it, so there's one amount.`
                    : `You set ${money(mine.amount)}.`
                  : `The plan put in ${money(pick.got)} (your priority order).`}
              </Text>
              {targets.map((x, j) => (
                <View key={x.key} style={styles.field}>
                  <Text style={[type.body, { color: t.text, flex: 1 }]} numberOfLines={1}>{targets.length > 1 ? x.name || label : k.startsWith("debt:") ? "Extra on top of the minimum" : "Put in"}</Text>
                  <NumberInput kind="money" label={`${x.name || label}, ${monthName(month)}`} value={vals[j] ?? 0} width={140} step={100} onChange={(v) => setVals((xs) => xs.map((y, i) => (i === j ? v : y)))} />
                </View>
              ))}
              <Segmented
                label="How long"
                value={on}
                options={[{ value: "month" as const, label: `Just ${mon}` }, { value: "on" as const, label: `${mon} on` }]}
                onChange={setOn}
              />
              <Text style={[type.caption, { color: t.text3 }]}>
                {on === "on" ? `Keeps this amount every month until you change it again.` : `Only ${monthName(month)}; other months stay as they are.`}
              </Text>
              <View style={[styles.after, { backgroundColor: leftAfter < -0.5 ? t.badSoft : t.goodSoft }]}>
                <Text style={[type.caption, { color: t.text, flex: 1 }]}>Left in {mon}</Text>
                {Math.abs(leftAfter - pick.left) > 0.5 ? <Text style={[type.caption, { color: t.text3, textDecorationLine: "line-through", fontVariant: ["tabular-nums"] }]}>{money(pick.left)}</Text> : null}
                <Text style={[type.label, { color: leftAfter < -0.5 ? t.bad : t.good, fontWeight: "800", fontVariant: ["tabular-nums"] }]}>{money(leftAfter)}</Text>
              </View>
              <Text style={[type.caption, { color: t.text3 }]}>The plan fills whatever's left in your priority order. Yearly limits still apply (the table shows what fits).</Text>
              <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
                {oneOff || startsHere ? <Button title={oneOff ? `Undo ${mon}` : `Remove the change from ${mon}`} tone="secondary" onPress={remove} /> : <Button title="Cancel" tone="secondary" onPress={onClose} />}
                <View style={{ flex: 1 }} />
                <Button title="Save" tone="primary" onPress={save} />
              </View>
            </>
          )}
          {pick.paycheck ? <Button title="Done" tone="secondary" onPress={onClose} /> : null}
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

/** A paycheck account: each job's per-check amount, with its changes by month (as a % of pay or dollars). */
function PaycheckParts({ state, k, got }: { state: PlanState; k: AccountKey; got: number }) {
  const t = useTheme();
  const jobs = state.incomes.filter((x) => (x.kind ?? "job") === "job" && (k === "k401" ? num(x.pretax) > 0 || num(x.contribPct) > 0 : num(x.hsaPre) > 0 || k === "hsa"));
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.caption, { color: t.text3 }]}>{money(got)} from your paychecks this month. It comes out before take-home, so changing it changes your take-home too.</Text>
      {jobs.length ? jobs.map((inc) => {
        const r = resolveIncome(inc);
        const base = k === "k401" ? num(r.pretax) : num(inc.hsaPre);
        return (
          <View key={inc.id} style={{ gap: 4 }}>
            <Text style={[type.overline, { color: t.text3 }]}>{inc.name || "Your job"}</Text>
            <Text style={[type.body, { color: t.text }]}>{money(base)} a check now</Text>
            <ChangesLater
              k={(k === "k401" ? PAY401 : PAYHSA) + inc.id}
              label={k === "k401" ? "Your 401(k)" : "Your HSA"}
              base={base}
              unit="/check"
              gross={k === "k401" ? inc.gross : undefined}
              prompt="Same every month."
            />
          </View>
        );
      }) : <Text style={[type.body, { color: t.text2 }]}>Set it per paycheck on your job (Money → Income).</Text>}
    </View>
  );
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 520, maxHeight: "85%", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, padding: space.md },
  field: { flexDirection: "row", alignItems: "center", gap: space.sm },
  after: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8 },
});
