import { k401Cost, type EmergencyMode } from "@coastfi/engine";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { longMonth } from "../../components/AdjustmentsCard";
import { Button, Toggle, ToggleRow } from "../../components/form";
import { Icon } from "../../components/Icon";
import { Card, Divider, Screen, SectionLabel } from "../../components/ui";
import { money } from "../../lib/format";
import { usePlan } from "../../lib/plan";
import { monthKey, useStore } from "../../lib/store";
import { radius, space, type, useTheme } from "../../lib/theme";

const LENGTHS = [1, 2, 3, 6, 12];

/** Emergency mode: pause the plan, keep cash, optionally cut to essentials / pause 401(k). */
export default function Emergency() {
  const t = useTheme();
  const { state, result: o, start } = usePlan();
  const update = useStore((s) => s.update);
  const d = o.d;
  const untilFor = (n: number) => monthKey(new Date(start.getFullYear(), start.getMonth() + n - 1, 1));
  const em: EmergencyMode = state.emergency ?? { active: false, until: untilFor(3), essentialsOnly: false, pause401k: false };
  const set = (patch: Partial<EmergencyMode>) => update((p) => { p.emergency = { ...em, ...patch }; });
  const length = LENGTHS.find((n) => untilFor(n) === em.until);

  // what the options are worth, from the engine's numbers
  const nonEssential = d.budgetTotal - (d.essentialExpenses - d.debtMins);
  const payroll401k = d.annualPre / 12;
  const take401k = payroll401k * k401Cost(state.plan.marginalTax, d.rothShare);
  const lostMatch = d.annualMatch / 12;
  const m0 = o.plan.months[0]!;
  const fmtRunway = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} months` : "no expenses set");

  return (
    <Screen title="Emergency mode" subtitle="For a job loss, a big bill, or a stretch that goes sideways" narrow hideSettings back>
      {/* on/off */}
      <Card style={{ gap: space.md, borderColor: em.active ? t.warn : t.border, borderWidth: em.active ? 2 : StyleSheet.hairlineWidth }}>
        <View style={styles.between}>
          <View style={{ flex: 1 }}>
            <Text style={[type.heading, { color: t.text }]}>{em.active ? `On through ${longMonth(em.until)}` : "Off"}</Text>
            <Text style={[type.caption, { color: t.text2 }]}>
              {em.active
                ? "Investing, extra debt payments and goals are paused. Everything left over each month stays in cash. Debt minimums are still paid."
                : "Turn it on to pause investing and keep every spare dollar in cash until things settle. Your normal plan resumes automatically."}
            </Text>
          </View>
          <Toggle label="Emergency mode" value={em.active} onChange={(v) => set({ active: v })} />
        </View>
        {em.active ? (
          <View style={[styles.note, { backgroundColor: t.warnSoft }]}>
            <Text style={[type.caption, { color: t.text }]}>
              This month: about <Text style={{ fontWeight: "700" }}>{money(m0.alloc.leftover)}</Text> stays in cash
              {m0.shortfall > 0.5 ? `, but you're short ${money(m0.shortfall)}` : ""}. Your coast date and odds already reflect the pause.
            </Text>
          </View>
        ) : null}
      </Card>

      {/* runway */}
      <Card style={{ gap: space.sm }}>
        <SectionLabel>If your income stopped today</SectionLabel>
        <View style={styles.runway}>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: t.text3 }]}>Essentials only</Text>
            <Text style={[type.stat, { color: d.runwayEssential < 3 ? t.warn : t.text }]}>{fmtRunway(d.runwayEssential)}</Text>
            <Text style={[type.caption, { color: t.text3 }]}>{money(d.essentialExpenses)}/mo incl. debt minimums</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: t.text3 }]}>Your full budget</Text>
            <Text style={[type.stat, { color: t.text }]}>{fmtRunway(d.emergencyMonths)}</Text>
            <Text style={[type.caption, { color: t.text3 }]}>{money(d.monthlyExpenses)}/mo</Text>
          </View>
        </View>
        <Text style={[type.caption, { color: t.text3 }]}>From {money(d.bal.cash)} in cash. Investments aren't counted: selling them in a downturn is a last resort.</Text>
      </Card>

      {/* options */}
      <Card style={{ gap: space.xs }}>
        <SectionLabel>How long?</SectionLabel>
        <View style={styles.chips} role="radiogroup" aria-label="How long">
          {LENGTHS.map((n) => {
            const on = n === length;
            return (
              <Pressable
                key={n}
                role="radio"
                aria-checked={on}
                accessibilityLabel={`${n} month${n > 1 ? "s" : ""}, through ${longMonth(untilFor(n))}`}
                onPress={() => set({ until: untilFor(n) })}
                style={[styles.chip, { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : t.surface }]}
              >
                <Text style={[type.label, { color: on ? "#fff" : t.text, fontWeight: "600" }]}>{n} mo</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[type.caption, { color: t.text3 }]}>
          Through {longMonth(em.until)}. A best guess is fine; you can turn it off early. It needs an end date so your long-term projection stays honest.
        </Text>

        <Divider />
        <ToggleRow
          label="Spend only on essentials"
          hint={nonEssential > 0 ? `Saves about ${money(nonEssential)}/mo while it's on` : "Untick anything below you'd stop paying"}
          value={em.essentialsOnly}
          onChange={(v) => set({ essentialsOnly: v })}
        />
        <View style={[styles.essentials, { backgroundColor: t.surface2 }]}>
          <Text style={[type.caption, { color: t.text3 }]}>Ticked = you'd keep paying it</Text>
          {state.budget.map((b, i) => {
            const keep = b.essential !== false;
            return (
              <Pressable
                key={b.id}
                role="checkbox"
                aria-checked={keep}
                accessibilityLabel={`Keep paying ${b.name || "item"}`}
                onPress={() => update((p) => { p.budget[i]!.essential = !keep; })}
                style={styles.essentialRow}
              >
                <View style={[styles.box, { borderColor: keep ? t.accent : t.border, backgroundColor: keep ? t.accent : "transparent" }]}>
                  {keep ? <Icon name="check" size={14} color="#fff" /> : null}
                </View>
                <Text style={[type.body, { color: keep ? t.text : t.text3, flex: 1 }]} numberOfLines={1}>{b.name || "Untitled item"}</Text>
                <Text style={[type.body, { color: keep ? t.text : t.text3, fontVariant: ["tabular-nums"], textDecorationLine: keep ? "none" : "line-through" }]}>{money(b.amount)}</Text>
              </Pressable>
            );
          })}
        </View>

        {payroll401k > 0 ? (
          <>
            <Divider />
            <ToggleRow
              label="Pause my 401(k) at work"
              hint={`About +${money(take401k)}/mo take-home, but you'd give up ${money(lostMatch)}/mo of employer match.`}
              value={em.pause401k}
              onChange={(v) => set({ pause401k: v })}
            />
            <Text style={[type.caption, { color: t.text3 }]}>
              You'd change this with your employer or payroll site; the app just plans around it. Usually a last step, since the match is free money.
            </Text>
          </>
        ) : null}
      </Card>

      {em.active ? <Button title="Turn off emergency mode" tone="danger" onPress={() => set({ active: false })} style={{ alignSelf: "flex-start" }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", gap: space.md },
  note: { borderRadius: radius.md, padding: space.md },
  runway: { flexDirection: "row", gap: space.lg, flexWrap: "wrap" },
  chips: { flexDirection: "row", gap: space.sm, flexWrap: "wrap", paddingVertical: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: 40, justifyContent: "center" },
  essentials: { borderRadius: radius.md, padding: space.md, gap: 2, marginBottom: space.sm },
  essentialRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 40 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
