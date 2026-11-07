import { StyleSheet, Text, View } from "react-native";
import { longMonth } from "../../components/AdjustmentsCard";
import { IconButton } from "../../components/form";
import { Icon } from "../../components/Icon";
import { ProgressBar } from "../../components/ProgressRing";
import { Card, Divider, Pill, Screen, SectionLabel } from "../../components/ui";
import { money, monthLabel } from "../../lib/format";
import { useLayout } from "../../lib/layout";
import { usePlan } from "../../lib/plan";
import { milestones, stepInfo, type StepInfo } from "../../lib/steps";
import { useStore } from "../../lib/store";
import { space, type, useTheme } from "../../lib/theme";

export default function Plan() {
  const t = useTheme();
  const { twoColumn } = useLayout();
  const { state, result: o, start } = usePlan();
  const update = useStore((s) => s.update);

  const infos = state.plan.steps.map((k) => stepInfo(k, state, o, start)).filter((x): x is StepInfo => !!x);
  const activeKey = infos.find((i) => !i.done && !i.skip)?.key;
  const move = (i: number, dir: -1 | 1) =>
    update((p) => {
      const s = p.plan.steps;
      const j = i + dir;
      if (j < 0 || j >= s.length) return;
      [s[i], s[j]] = [s[j]!, s[i]!];
    });

  const steps = (
    <Card padded={false} style={twoColumn ? { flex: 3 } : undefined}>
      <View style={{ padding: space.lg, paddingBottom: space.md, gap: 4 }}>
        <SectionLabel>Where the next dollar goes</SectionLabel>
        <Text style={[type.body, { color: t.text2 }]}>
          Each month, money left after your budget and debt minimums fills step 1, then spills into step 2, and so on. Use the arrows to change the order.
        </Text>
      </View>
      <Divider />
      {infos.map((info, i) => {
        const active = info.key === activeKey;
        const idx = state.plan.steps.indexOf(info.key);
        return (
          <View key={info.key}>
            <View style={styles.step}>
              <View
                style={[
                  styles.num,
                  { backgroundColor: info.done ? t.good : active ? t.accent : t.surface2 },
                ]}
              >
                {info.done ? (
                  <Icon name="check" size={14} color="#fff" />
                ) : (
                  <Text style={[type.caption, { fontWeight: "700", color: active ? "#fff" : t.text2 }]}>{i + 1}</Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
                  <Text style={[type.body, { fontWeight: "600", color: info.done || info.skip ? t.text3 : t.text }]}>{info.label}</Text>
                  {active ? <Pill tone="accent">Now</Pill> : null}
                  {info.action ? <Pill tone="bad">Action needed</Pill> : null}
                </View>
                <Text style={[type.caption, { color: t.text2 }]}>{info.meta}</Text>
                {info.progress !== undefined && !info.done ? (
                  <View style={{ maxWidth: 280, marginTop: 4 }}>
                    <ProgressBar progress={info.progress} color={t.good} />
                  </View>
                ) : null}
              </View>
              <View style={styles.moves}>
                <IconButton icon="up" label={`Move ${info.label} up`} disabled={idx === 0} onPress={() => move(idx, -1)} />
                <IconButton icon="down" label={`Move ${info.label} down`} disabled={idx === state.plan.steps.length - 1} onPress={() => move(idx, 1)} />
              </View>
            </View>
            {i < infos.length - 1 ? <View style={{ marginLeft: 60 }}><Divider /></View> : null}
          </View>
        );
      })}
    </Card>
  );

  const items = milestones(o, state);
  const timeline = (
    <Card>
      <SectionLabel>Milestone timeline</SectionLabel>
      {items.length === 0 ? <Text style={[type.body, { color: t.text3 }]}>No milestones in range.</Text> : null}
      {items.map((x, i) => (
        <View key={`${x.m}-${i}`} style={[styles.tl, i < items.length - 1 ? { borderBottomColor: t.border, borderBottomWidth: StyleSheet.hairlineWidth } : null]}>
          <Text style={[type.caption, { color: t.text3, width: 76, fontVariant: ["tabular-nums"] }]}>{x.m === 0 ? "This month" : monthLabel(start, x.m)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
            {x.big ? <Icon name="target" size={16} color={t.accent} /> : null}
            <Text style={[type.body, { flex: 1, color: x.minor ? t.text2 : t.text, fontWeight: x.big ? "700" : "400" }]}>{x.text}</Text>
          </View>
        </View>
      ))}
    </Card>
  );

  const better = o.projectedFinal >= o.altFinal;
  const compare = (
    <Card style={{ gap: space.sm }}>
      <SectionLabel>Why follow the plan?</SectionLabel>
      <View style={styles.cmp}>
        <View style={{ flex: 1 }}>
          <Text style={[type.caption, { color: t.text3 }]}>If you follow this plan</Text>
          <Text style={[type.stat, { color: t.text }]}>{money(o.projectedFinal, { compact: true })}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.caption, { color: t.text3 }]}>If you keep investing {money(state.currentInvestMonthly)}/mo like today</Text>
          <Text style={[type.stat, { color: t.text2 }]}>{money(o.altFinal, { compact: true })}</Text>
        </View>
      </View>
      <Text style={[type.caption, { color: t.text3 }]}>
        What you'd have invested by age {o.d.retireAge} (at your assumed return, no market swings).{" "}
        {better ? `Following the plan comes out ${money(o.projectedFinal - o.altFinal, { compact: true })} ahead.` : ""}
      </Text>
    </Card>
  );

  return (
    <Screen title="Plan" subtitle="Where the next dollar goes">
      {state.emergency?.active ? (
        <Card style={{ backgroundColor: t.warnSoft, borderColor: t.warn }}>
          <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>Paused for emergency mode through {longMonth(state.emergency.until)}</Text>
          <Text style={[type.caption, { color: t.text2 }]}>Until then everything left over stays in cash. These steps pick up again the month after; the dates below already account for the pause.</Text>
        </Card>
      ) : null}
      {twoColumn ? (
        <View style={{ flexDirection: "row", gap: space.lg, alignItems: "flex-start" }}>
          {steps}
          <View style={{ flex: 2, gap: space.lg }}>
            {compare}
            {timeline}
          </View>
        </View>
      ) : (
        <>
          {steps}
          {compare}
          {timeline}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  moves: { flexDirection: "row", alignItems: "center" },
  tl: { flexDirection: "row", gap: space.md, paddingVertical: 10, alignItems: "flex-start" },
  cmp: { flexDirection: "row", gap: space.lg },
});
