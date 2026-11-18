/**
 * Your number: the answer first (your FIRE number, your Coast number today, where you stand), then how
 * it's worked out in five steps that open one at a time, then the other kinds of FI (folded away).
 * What-ifs live on Forecast; the withdrawal rate is a real setting, so it stays in step 3.
 */
import { baristaFi, DISPLAY_INFLATION, FAT_FACTOR, fireBreakdown, fiLevels, inFutureDollars } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money, monthLabel, percent } from "../lib/format";
import { usePlan } from "../lib/plan";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Select } from "./form";
import { Icon } from "./Icon";
import { Card, Divider, Pill, SectionLabel } from "./ui";
import { useOpenPage } from "../lib/nav";

const SWRS = [0.03, 0.0325, 0.035, 0.0375, 0.04, 0.045];

/** `onView`: switch the Forecast view (Your number is one of them); without it, links open Forecast at that view. */
export function NumberBreakdown({ onView }: { onView?: (v: "retirement" | "whatif") => void } = {}) {
  const t = useTheme();
  const router = useRouter();
  const openPage = useOpenPage();
  const { state, result: o, start } = usePlan();
  const update = useStore((s) => s.update);
  const b = fireBreakdown(state, o);
  const levels = fiLevels(state, o);
  const barista = baristaFi(o);
  const d = o.d;
  const yearsToRetire = Math.max(0, d.retireAge - d.age);
  const retireYear = start.getFullYear() + Math.round(yearsToRetire);
  // one step open at a time; the other kinds of FI start folded
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const toView = (v: "retirement" | "whatif") => (onView ? onView(v) : router.navigate(`/plan?view=${v}` as never));

  const whole = (v: number) => money(v, { whole: true });
  const rate = (v: number) => percent(v, 2).replace(/0%$/, "%").replace(/\.0%$/, "%");
  const per = (yearly: number) => `${whole(yearly)}/yr · ${whole(yearly / 12)}/mo`;
  const row = (label: string, value: string, opts: { sub?: string; strong?: boolean; tone?: string } = {}) => (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[opts.strong ? type.body : type.caption, { color: opts.strong ? t.text : t.text2, fontWeight: opts.strong ? "700" : "500" }]}>{label}</Text>
        {opts.sub ? <Text style={[type.caption, { color: t.text3 }]}>{opts.sub}</Text> : null}
      </View>
      <Text style={[opts.strong ? type.body : type.caption, { color: opts.tone ?? t.text, fontWeight: opts.strong ? "700" : "600", fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  );
  const link = (title: string, onPress: () => void) => (
    <Pressable role="link" onPress={onPress} hitSlop={6} style={{ alignSelf: "flex-start", marginTop: 2 }}>
      <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{title} →</Text>
    </Pressable>
  );
  /** A step: its number, title and result on one line; open it for one plain sentence and the details. */
  const step = (n: number, title: string, result: string, explain: string, body: ReactNode) => {
    const open = openStep === n;
    return (
      <View key={n} style={{ gap: space.sm }}>
        {n > 1 ? <Divider /> : null}
        <Pressable role="button" aria-expanded={open} accessibilityLabel={`Step ${n}, ${title}: ${result}. ${open ? "Hide" : "Show"} how`} onPress={() => setOpenStep(open ? null : n)} style={styles.stepHead}>
          <View style={[styles.num, { backgroundColor: t.accentSoft }]}>
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{n}</Text>
          </View>
          <Text style={[type.label, { color: t.text, fontWeight: "700", flex: 1, minWidth: 0 }]}>{title}</Text>
          <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{result}</Text>
          <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
            <Icon name="chevron" size={14} color={t.text3} />
          </View>
        </Pressable>
        {open ? (
          <View style={{ gap: space.sm, paddingLeft: 30 }}>
            <Text style={[type.caption, { color: t.text2 }]}>{explain}</Text>
            <View style={{ gap: 2 }}>{body}</View>
          </View>
        ) : null}
      </View>
    );
  };
  const swrOptions = SWRS.map((v) => ({ value: String(v), label: rate(v) }));
  if (!SWRS.includes(d.swr)) swrOptions.push({ value: String(d.swr), label: percent(d.swr, 2) });
  const reached = b.invested >= b.coastNow;
  const whatIf = Math.abs(num(state.whatif?.spendDelta)) > 0.0001;

  // when your plan gets there: Coast FI (savings catch up with the Coast number), and the FIRE number itself
  const coastMonths = o.crossing === null ? null : Math.round(o.crossing * 12);
  const fireMonths = o.whenBalance(b.fire);
  const retireMonths = Math.round(yearsToRetire * 12);
  const ageAt = (m: number) => Math.floor(d.age + m / 12);
  const when = (m: number) => (m <= 0 ? "now" : `${monthLabel(start, m)} (age ${ageAt(m)})`);
  const pointRow = (dot: string, title: string, sub: string, last = false) => (
    <View style={styles.point}>
      <View style={{ alignItems: "center", width: 14 }}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        {last ? null : <View style={[styles.stem, { backgroundColor: t.border }]} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : space.sm }}>
        <Text style={[type.label, { color: t.text, fontWeight: "700" }]}>{title}</Text>
        <Text style={[type.caption, { color: t.text3 }]}>{sub}</Text>
      </View>
    </View>
  );

  // the answer: the two numbers in plain words, and when your plan reaches each
  const answer = (
    <Card style={{ gap: space.md }}>
      <View style={styles.answers}>
        <View style={[styles.answer, { backgroundColor: t.surface2 }]}>
          <Text style={[type.caption, { color: t.text3 }]}>Your FIRE number</Text>
          <Text style={[type.title, { color: whatIf ? t.warn : t.text, fontVariant: ["tabular-nums"] }]}>{whole(b.fire)}</Text>
          <Text style={[type.caption, { color: t.text2 }]}>
            What you need invested on the day you retire at {d.retireAge}, so it pays your retirement spending for life. In today's dollars.
          </Text>
        </View>
        <View style={[styles.answer, { backgroundColor: t.surface2 }]}>
          <Text style={[type.caption, { color: t.text3 }]}>Your Coast number today</Text>
          <Text style={[type.title, { color: whatIf ? t.warn : reached ? t.good : t.text, fontVariant: ["tabular-nums"] }]}>{whole(b.coastNow)}</Text>
          <Text style={[type.caption, { color: t.text2 }]}>
            Have this much invested today and never add another dollar: at about {percent(b.r, 1)} a year after inflation, it grows into your FIRE number by {d.retireAge}.
          </Text>
        </View>
      </View>

      {/* how the two connect: your savings catch up with the Coast number, then growth does the rest */}
      <View style={{ gap: 0 }}>
        <Text style={[type.overline, { color: t.text3, marginBottom: space.sm }]}>On your plan</Text>
        {pointRow(t.accent, `Today: ${whole(b.invested)} invested`, reached ? "Already past your Coast number." : `${whole(b.coastNow - b.invested)} short of your Coast number. It goes up a little each year (less time left to grow), so your savings have to catch it.`)}
        {pointRow(
          reached ? t.good : coastMonths === null ? t.bad : t.text3,
          reached ? "Coast FI: reached" : coastMonths === null ? `Coast FI: not before ${d.retireAge}` : `Coast FI: ${when(coastMonths)}`,
          reached || coastMonths !== null
            ? `From here you could stop investing: what you have grows into ${whole(b.fire)} by ${d.retireAge}. You'd only need to cover today's bills.`
            : "Your plan doesn't catch up before you retire. Saving more, spending less in retirement or retiring later would change that.",
        )}
        {pointRow(
          fireMonths !== null && fireMonths <= retireMonths ? t.good : t.text3,
          fireMonths !== null && fireMonths < retireMonths ? `FIRE number: ${when(fireMonths)}` : `Retire at ${d.retireAge}: ${whole(b.fire)}`,
          fireMonths !== null && fireMonths < retireMonths
            ? `Keep investing as planned and you'd have your FIRE number before ${d.retireAge}: you could retire then.`
            : `About ${whole(b.planValue)} by then on your plan${b.planValue + 0.5 >= b.fire ? ", enough." : `, ${whole(b.fire - b.planValue)} short.`}`,
          true,
        )}
      </View>
      {whatIf ? (
        <Text style={[type.caption, { color: t.warn, fontWeight: "700" }]}>
          Includes a what-if from Forecast (retirement spending {num(state.whatif?.spendDelta) >= 0 ? "+" : "−"}{Math.round(Math.abs(num(state.whatif?.spendDelta)) * 100)}%).
        </Text>
      ) : null}
    </Card>
  );

  const breakdown = (
    <Card style={{ gap: space.sm }}>
      <SectionLabel>How it's worked out</SectionLabel>
      {step(1, "What you'll spend", `${whole(b.retireAnnual / 12)}/mo`,
        d.retireSpendingSet ? "The yearly amount you set for retirement." : "The budget categories you'd still pay after retiring, plus healthcare and your homes' taxes and insurance.",
        <>
          {b.spending.map((x) => <View key={x.key}>{row(x.label, `${x.monthly < 0 ? "−" : ""}${whole(Math.abs(x.monthly))}/mo`, x.key === "whatif" ? { sub: "From the what-ifs on Forecast", tone: t.warn } : {})}</View>)}
          <Divider />
          {row("Retirement spending", per(b.retireAnnual), { strong: true, sub: d.retireSpendingSet ? `Your budget's retirement items add up to ${whole(d.retireMonthlyBudget * 12)}/yr` : undefined })}
          {link(d.retireSpendingSet ? "Change your set amount" : "Choose categories and amounts", () => toView("retirement"))}
          {link("Change healthcare", () => toView("retirement"))}
        </>)}
      {step(2, "From your savings", `${whole(b.need / 12)}/mo`,
        "What's left after Social Security, pensions and rent you'll keep getting.",
        <>
          {row("Retirement spending", per(b.retireAnnual))}
          {b.income - b.rentalIncome > 0.5 ? row("Social Security and pensions", `− ${per(b.income - b.rentalIncome)}`) : null}
          {Math.abs(b.rentalIncome) > 0.5 ? row("Rent you keep getting", `${b.rentalIncome >= 0 ? "−" : "+"} ${per(Math.abs(b.rentalIncome))}`, { sub: "Less a cushion for empty months" }) : null}
          <Divider />
          {row("From your savings", per(b.need), { strong: true })}
          {link(b.income - b.rentalIncome > 0.5 ? "Change Social Security and pensions" : "Add Social Security or a pension", () => toView("retirement"))}
        </>)}
      {step(3, "Your FIRE number", whole(b.fire),
        `Enough that taking out ${rate(b.swr)} a year covers it for life, plus what you need before other income starts and to finish any mortgage.`,
        <>
          {row(`${whole(b.need)} ÷ ${rate(b.swr)}`, whole(b.base))}
          {b.taxExtra > 0.5 ? row("Income tax on pre-tax money", `+ ${whole(b.taxExtra)}`, { sub: `${percent(d.taxRate)} tax on the ${percent(o.preShareFinal)} that's pre-tax` }) : null}
          {b.bridge > 0.5 ? row("Until Social Security or a pension starts", `+ ${whole(b.bridge)}`) : null}
          {b.healthBridge > 0.5 ? row("Health insurance until 65", `+ ${whole(b.healthBridge)}`, { sub: `${whole(state.healthcare)}/mo from ${d.retireAge} until Medicare` }) : null}
          {b.homeBridge > 0.5 ? row(o.mortgagesAtRetire.length > 1 ? "Mortgages still owed" : "Mortgage still owed", `+ ${whole(b.homeBridge)}`, { sub: `What's left when you retire: ${o.mortgagesAtRetire.map((x) => x.name || "Mortgage").join(", ")}` }) : null}
          <Divider />
          {row("FIRE number", whole(b.fire), { strong: true, sub: b.fire > 0.5 ? `About ${whole(inFutureDollars(b.fire, yearsToRetire))} in ${retireYear} dollars (${percent(DISPLAY_INFLATION)} inflation a year)` : undefined })}
          <View style={[styles.row, { flexWrap: "wrap", marginTop: space.xs }]}>
            <Text style={[type.caption, { color: t.text3, flex: 1, minWidth: 160 }]}>Withdrawal rate: lower is safer and needs more saved.</Text>
            <Select label="Withdrawal rate" value={String(d.swr)} options={swrOptions} onChange={(v) => update((p) => { p.swr = Number(v); })} />
          </View>
        </>)}
      {step(4, "Your Coast number today", whole(b.coastNow),
        `What you'd need invested today to grow into your FIRE number by ${d.retireAge} without adding more.`,
        <>
          {row(`${whole(b.fire)} ÷ ${b.growth.toFixed(2)}`, whole(b.coastNow), { sub: `A dollar today grows ${b.growth.toFixed(2)}× in ${b.years} years at ${percent(b.r, 1)} a year after inflation` })}
          {row("You have invested", whole(b.invested), { tone: reached ? t.good : undefined })}
          <Divider />
          {row(reached ? "You've reached Coast FI" : "Still to go", reached ? "✓" : whole(b.coastNow - b.invested), { strong: true, tone: reached ? t.good : undefined })}
        </>)}
      {step(5, "What your money supports", `${whole(b.planSupports / 12)}/mo`,
        "The spending your savings would pay for in retirement, if you stopped saving today or kept to your plan.",
        <>
          {row("If you stopped saving today", per(b.coastSupports), { sub: `${whole(b.invested)} grows to ${whole(b.coastValue)} by ${d.retireAge}` })}
          {row("On your plan", per(b.planSupports), { sub: `About ${whole(b.planValue)} by ${d.retireAge}` })}
          {row("You plan to spend", per(b.retireAnnual), { strong: true })}
        </>)}
      <View style={{ marginTop: space.xs }}>
        {whatIf ? (
          <Pressable role="link" onPress={() => toView("whatif")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
            <Text style={[type.caption, { color: t.warn, fontWeight: "700" }]}>A what-if is on: change it →</Text>
          </Pressable>
        ) : link("Try what-ifs", () => toView("whatif"))}
      </View>
    </Card>
  );

  const ladder = (
    <Card style={{ gap: space.md }}>
      <Pressable role="button" aria-expanded={levelsOpen} accessibilityLabel={`Other kinds of FI: ${levelsOpen ? "hide" : "show"}`} onPress={() => setLevelsOpen((v) => !v)} style={styles.stepHead}>
        <Text style={[type.label, { color: t.text, fontWeight: "700", flex: 1 }]}>Other kinds of FI</Text>
        <Text style={[type.caption, { color: t.text3 }]}>Lean, Fat, Barista</Text>
        <View style={{ transform: [{ rotate: levelsOpen ? "90deg" : "0deg" }] }}>
          <Icon name="chevron" size={14} color={t.text3} />
        </View>
      </Pressable>
      {levelsOpen ? (
        <>
          <Text style={[type.caption, { color: t.text3 }]}>The same math at other spending levels. Coast is reached when what you have invested today grows into that level's number by {d.retireAge}.</Text>
          {levels.map((l, i) => {
            // everything you'll spend is essential: Lean is the same as FI, so just say so
            if (l.key === "lean" && Math.abs(l.monthly - d.retireMonthly) < 0.5)
              return (
                <View key={l.key} style={{ gap: 4 }}>
                  <Text style={[type.body, { color: t.text, fontWeight: "700" }]}>{l.label}</Text>
                  <Text style={[type.caption, { color: t.text3 }]}>Same as FI: everything you'll spend in retirement is marked essential. Turn off Essential on a category (travel, dining out) to see a leaner number.</Text>
                </View>
              );
            const done = d.invested >= l.coastNow;
            const when = done ? "Reached" : l.coastIn === null ? `Not before ${d.retireAge}` : l.coastIn === 0 ? "This month" : `Coast by ${monthLabel(start, l.coastIn)}`;
            return (
              <View key={l.key} style={{ gap: 4 }}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <Text style={[type.body, { color: t.text, fontWeight: "700", flex: 1 }]}>{l.label}</Text>
                  <Pill tone={done ? "good" : l.key === "fi" ? "accent" : "neutral"}>{when}</Pill>
                </View>
                <Text style={[type.caption, { color: t.text3 }]}>
                  {l.key === "lean" ? "Essentials only: what you'd keep in a money emergency, plus healthcare and housing." : l.key === "fi" ? "Your retirement spending, as planned." : `${FAT_FACTOR}× your retirement spending: room for more travel, gifts and comfort.`}
                </Text>
                {row("Spending", per(l.monthly * 12))}
                {row("FIRE number", whole(l.fire))}
                {row("Coast number today", whole(l.coastNow), { tone: done ? t.good : undefined })}
              </View>
            );
          })}
          <Divider />
          <View style={{ gap: 4 }}>
            <View style={styles.row}>
              <Text style={[type.body, { color: t.text, fontWeight: "700", flex: 1 }]}>Barista FI</Text>
              <Pill tone="neutral">{`${whole(barista.monthly)}/mo`}</Pill>
            </View>
            <Text style={[type.caption, { color: t.text3 }]}>
              If you stopped investing from your paycheck today: what you'd need to earn a month until {d.retireAge}, say from part-time work, to pay your costs{barista.saving > 0.5 ? " and still reach your FIRE number" : ". You've reached Coast FI, so your costs are all"}.
            </Text>
            {row("Today's monthly costs", `${whole(barista.costs)}/mo`)}
            {barista.saving > 0.5 ? row("Still to save to reach your number", `${whole(barista.saving)}/mo`) : null}
          </View>
          {link("Mark what's essential on the Budget", () => router.push("/budget"))}
        </>
      ) : null}
    </Card>
  );

  return (
    <>
      {answer}
      {breakdown}
      {ladder}
    </>
  );
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 3 },
  stepHead: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36 },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  answers: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  answer: { flexGrow: 1, flexBasis: 220, borderRadius: radius.md, padding: space.md, gap: 2 },
  point: { flexDirection: "row", gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  stem: { width: 2, flex: 1, marginTop: 2 },
});
