/**
 * Your number: the answer first (your FIRE number, your Coast number today, where you stand), then how
 * it's worked out in five steps that open one at a time, then the other kinds of FI (folded away).
 * What-ifs live on Forecast; the withdrawal rate is a real setting, so it stays in step 3.
 */
import { ACCESS_AGE, baristaFi, DISPLAY_INFLATION, earlyAccess, extraToRetire, FAT_FACTOR, fireBreakdown, fiLevels, inFutureDollars, investingNow, investingSplit, investingStarts, mortgagePayoffs, retireAgeOnPlan, finalAndFire, type WhatIf } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { money, monthLabel, percent } from "../lib/format";
import { NO_WHATIF, usePlan } from "../lib/plan";
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
  // these run the forecast again (a few dozen times): only when the plan changes
  const extra = useMemo(() => (d.years > 0 ? extraToRetire(state, start) : 0), [state, start, d.years]);
  const laterAge = useMemo(() => (extra > 0.5 ? retireAgeOnPlan(state, start) : null), [state, start, extra > 0.5]);
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

  // why step 5 says what it says: the money set aside first, then what's left pays a share a year
  const setAside = b.bridge + b.healthBridge + b.homeBridge;
  const setAsideFor = [
    b.healthBridge > 0.5 ? `health insurance until 65` : "",
    b.bridge > 0.5 ? "the years before Social Security or a pension" : "",
    b.homeBridge > 0.5 ? "the mortgage payments left" : "",
  ].filter(Boolean).join(", ");
  const incomeMo = b.income / 12;
  const onTrackWhy =
    setAside > 0.5 && b.planValue <= setAside + 0.5
      ? `On your plan you'd have about ${whole(b.planValue)} at ${d.retireAge}. Paying for ${setAsideFor} (${whole(setAside)}) uses all of it first, so nothing is left for your monthly spending${incomeMo > 0.5 ? `: only the ${whole(incomeMo)}/mo that comes in on its own` : ""}.`
      : `On your plan you'd have about ${whole(b.planValue)} at ${d.retireAge}.${setAside > 0.5 ? ` After ${whole(setAside)} for ${setAsideFor},` : ""} taking out ${rate(b.swr)} a year pays about ${whole(Math.max(0, b.planSupports - b.income) / 12)}/mo${incomeMo > 0.5 ? `, plus ${whole(incomeMo)}/mo that comes in on its own` : ""}. You plan to spend ${whole(b.retireAnnual / 12)}/mo.`;

  // how you get there: what you invest now (and where it goes), then whether that's enough, and ways to close a gap
  const nowMo = investingNow(o);
  const split = investingSplit(o);
  const startsIn = investingStarts(o);
  const nowSub =
    startsIn === null
      ? `Nothing on your plan goes into investments yet: after bills, nothing's left over. What you have, ${whole(b.invested)}, still grows.`
      : startsIn > 0
        ? `Starts ${monthLabel(start, startsIn)}: until then your plan pays debts or builds savings first. This is a typical month once it starts.`
        : "A typical month this year, employer match included";
  const splitRows = [
    { k: "401(k)", v: split.k401 },
    { k: "Employer match", v: split.match },
    { k: "IRA", v: split.ira },
    { k: "HSA", v: split.hsa },
    { k: "Brokerage", v: split.taxable },
    { k: "Paying back your 401(k) loan", v: split.loanBack },
    { k: "Other", v: split.other },
  ].filter((x) => x.v > 0.5);
  // bills beyond income: the first part of any extra covers that
  const shortMo = o.plan.months.slice(0, 12).reduce((a, m) => a + m.shortfall, 0) / 12;
  const payoffs = mortgagePayoffs(state, o);
  const spendMo = b.retireAnnual / 12;
  const paysMo = b.planSupports / 12;
  const gapMo = Math.max(0, spendMo - paysMo);
  // the ways to close the gap, each enough on its own; tick any mix and see them together
  type Way = { key: string; title: string; value: (f: number) => string; sub: string; apply: (w: WhatIf, f: number) => void };
  const ways: Way[] = [];
  if (Number.isFinite(extra) && extra > 0.5)
    ways.push({ key: "extra", title: "Invest more", value: (f) => `${whole(extra * f)}/mo`, sub: `Every month until ${d.retireAge}, on top of today's ${whole(nowMo)}.${shortMo > 0.5 ? ` The first ${whole(shortMo)} covers bills beyond your pay.` : ""}`, apply: (w, f) => { w.extra = Math.round(extra * f); } });
  if (laterAge !== null && laterAge > d.retireAge)
    ways.push({ key: "later", title: "Retire later", value: (f) => `At ${d.retireAge + Math.ceil((laterAge - d.retireAge) * f - 1e-9)}`, sub: "Keep investing as you do now", apply: (w, f) => { const a = d.retireAge + Math.ceil((laterAge - d.retireAge) * f - 1e-9); if (a !== d.retireAge) w.retireAge = a; } });
  if (spendMo > 0.5 && paysMo < spendMo - 0.5)
    ways.push({ key: "spend", title: "Spend less in retirement", value: (f) => `${whole(spendMo - (spendMo - paysMo) * f)}/mo`, sub: `${whole(spendMo - paysMo)}/mo less than you planned, on its own`, apply: (w, f) => { w.spendDelta = -((spendMo - paysMo) * f) / spendMo; } });
  for (const p of payoffs)
    ways.push({ key: "loan:" + p.id, title: `Pay down ${p.name || "the mortgage"}`, value: (f) => `${whole(p.extra * f)}/mo`, sub: `More on the loan until ${d.retireAge} (on its own, enough to pay it off then)`, apply: (w, f) => { w.loanExtra = { ...(w.loanExtra ?? {}), [p.id]: Math.round(p.extra * f) }; } });
  const [picked, setPicked] = useState<string[]>([]);
  const chosen = ways.filter((x) => picked.includes(x.key));
  const trial = useMemo(() => {
    if (!chosen.length) return null;
    const at = (f: number) => {
      const w: WhatIf = { ...NO_WHATIF };
      for (const x of chosen) x.apply(w, f);
      const r = finalAndFire({ ...state, whatif: w }, start);
      return { w, final: r.final, fire: r.fire, age: r.d.retireAge, f };
    };
    // one alone: all of it. Several: each at the same share, as small as gets you there together
    if (chosen.length === 1) return at(1);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const r = at(mid);
      if (r.final + 0.5 >= r.fire) hi = mid;
      else lo = mid;
    }
    return at(hi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.join(","), state, start]);
  const getThere = d.years <= 0 ? null : (
    <>
      <Card style={{ gap: space.sm }}>
        <SectionLabel>What you invest</SectionLabel>
        {row("You invest now", `${whole(nowMo)}/mo`, { strong: true, sub: nowSub })}
        {splitRows.length > 1 ? (
          <View style={[styles.split, { backgroundColor: t.surface2 }]}>
            {splitRows.map((x) => <View key={x.k}>{row(x.k, `${whole(x.v)}/mo`)}</View>)}
          </View>
        ) : null}
        <Text style={[type.caption, { color: t.text3 }]}>Where it goes follows your plan's priority order.</Text>
        {link("Change the order", () => openPage("/settings/priorities"))}
      </Card>
      <Card style={{ gap: space.sm }}>
        <SectionLabel>Are you on track?</SectionLabel>
        {extra <= 0.5 ? (
          <View style={[styles.verdict, { backgroundColor: t.goodSoft }]}>
            <Text style={[type.label, { color: t.text, fontWeight: "800" }]}>On track ✓</Text>
            <Text style={[type.caption, { color: t.text2 }]}>
              Keep investing about {whole(nowMo)}/mo and at {d.retireAge} your savings would pay {whole(paysMo)}/mo, for the {whole(spendMo)}/mo you plan to spend.
            </Text>
          </View>
        ) : null}
        {extra <= 0.5 ? (
          link("Try what-ifs (retire earlier, spend more)", () => toView("whatif"))
        ) : (
          <>
            <View style={[styles.verdict, { backgroundColor: t.warnSoft }]}>
              <Text style={[type.label, { color: t.text, fontWeight: "800" }]}>{gapMo > 0.5 ? `You're ${whole(gapMo)}/mo short` : "Not quite on track"}</Text>
              <Text style={[type.caption, { color: t.text2 }]}>
                At {d.retireAge} your savings would pay {whole(paysMo)}/mo. You want to spend {whole(spendMo)}/mo.
              </Text>
            </View>
            {ways.length ? <Text style={[type.label, { color: t.text, fontWeight: "700", marginTop: space.xs }]}>Close the gap: tick any mix</Text> : null}
            {ways.map((x, i) => {
              const on = picked.includes(x.key);
              return (
                <View key={x.key}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable
                    role="checkbox"
                    aria-checked={on}
                    accessibilityLabel={`${x.title}: ${x.value(on && trial ? trial.f : 1)}`}
                    onPress={() => setPicked((p) => (on ? p.filter((k) => k !== x.key) : [...p, x.key]))}
                    style={styles.way}
                  >
                    <View style={[styles.box, { borderColor: on ? t.warn : t.border, backgroundColor: on ? t.warn : "transparent" }]}>
                      {on ? <Icon name="check" size={14} color="#fff" /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.body, { color: t.text }]}>{x.title}</Text>
                      <Text style={[type.caption, { color: t.text3 }]}>{on && trial && chosen.length > 1 ? `With the others. On its own: ${x.value(1)}` : x.sub}</Text>
                    </View>
                    <Text style={[type.body, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{x.value(on && trial ? trial.f : 1)}</Text>
                  </Pressable>
                </View>
              );
            })}
            {trial ? (
              <View style={[styles.verdict, { backgroundColor: trial.final + 0.5 >= trial.fire ? t.goodSoft : t.warnSoft, marginTop: space.xs }]}>
                <Text style={[type.label, { color: t.text, fontWeight: "800" }]}>
                  {trial.final + 0.5 >= trial.fire
                    ? `With ${chosen.length === 1 ? "this" : `these ${chosen.length}`}: on track ✓`
                    : `With ${chosen.length === 1 ? "this" : `these ${chosen.length}`}: still ${whole(trial.fire - trial.final)} short`}
                </Text>
                <Text style={[type.caption, { color: t.text2 }]}>
                  About {whole(trial.final)} invested at {trial.age}, for a FIRE number of {whole(trial.fire)}
                  {trial.final > trial.fire + 0.5 ? ` (${whole(trial.final - trial.fire)} to spare)` : ""}.
                </Text>
              </View>
            ) : null}
            <Pressable
              role="button"
              onPress={() => {
                if (trial) update((p) => { p.whatif = { ...trial.w }; });
                toView("whatif");
              }}
              style={[styles.cta, { backgroundColor: t.warn }]}
            >
              <Text style={[type.label, { color: "#fff", fontWeight: "700" }]}>{trial ? "Open in What if" : "Try your own mix in What if"}</Text>
            </Pressable>
            <Text style={[type.caption, { color: t.text3 }]}>Fine-tune there; nothing changes your plan until you make it yours.</Text>
          </>
        )}
      </Card>
    </>
  );

  // retiring before 59½: the years until then are paid from money you can reach early (brokerage)
  const early = earlyAccess(state, o);
  const yrs = (v: number) => (Math.abs(v - Math.round(v)) < 0.01 ? `${Math.round(v)}` : v.toFixed(1));
  const beforeAccess = !early ? null : (
    <Card style={{ gap: space.sm }}>
      <SectionLabel>Can you reach enough before 59½?</SectionLabel>
      <Text style={[type.caption, { color: t.text2 }]}>
        You retire at {d.retireAge}. 401(k)s and IRAs charge a 10% penalty until 59½, so those {yrs(early.years)} years come from money you can reach: your brokerage.
      </Text>
      {row(`You'll need from ${d.retireAge} to 59½`, whole(early.need), { strong: true })}
      <View style={[styles.split, { backgroundColor: t.surface2 }]}>
        {row(`Spending, ${yrs(early.years)} years`, whole(early.spending))}
        {early.income > 0.5 ? row("Income that comes in by then", `− ${whole(early.income)}`) : null}
        {early.health > 0.5 ? row("Health insurance until then", `+ ${whole(early.health)}`, { sub: "Beyond what you'd pay on Medicare" }) : null}
        {early.mortgage > 0.5 ? row("Your mortgage", `+ ${whole(early.mortgage)}`, { sub: o.mortgagesAtRetire.every((x) => x.choice === "payoff") ? "Paying it off when you retire" : "Keeping up its payments after you retire" }) : null}
      </View>
      {row(`Your brokerage at ${d.retireAge}`, whole(early.reachable), { sub: "On your plan" })}
      {early.short > 0.5 ? (
        <>
          <View style={[styles.verdict, { backgroundColor: t.warnSoft }]}>
            <Text style={[type.label, { color: t.text, fontWeight: "800" }]}>{whole(early.short)} short of money you can reach</Text>
            <Text style={[type.caption, { color: t.text2 }]}>This is about where your money is, not how much: too much of it is in accounts you can't touch until 59½.</Text>
          </View>
          <Text style={[type.label, { color: t.text, fontWeight: "700", marginTop: space.xs }]}>The fix: move, not more</Text>
          {row("Send to your brokerage instead", `${whole(early.extraMonthly)}/mo`, {
            sub: `Of what you already invest, so ${whole(early.extraMonthly)}/mo goes to your brokerage instead of a 401(k) or IRA until ${d.retireAge}. Same total. Keep your 401(k) at least up to your employer's full match.`,
          })}
          {link("Change my plan's order", () => openPage("/settings/priorities"))}
          {extra > 0.5 ? <Text style={[type.caption, { color: t.text3 }]}>If you also invest more (above), put that in your brokerage too: it counts toward both.</Text> : null}
        </>
      ) : row("Covered", "✓", { strong: true, tone: t.good })}
      <Text style={[type.caption, { color: t.text3 }]}>
        On the safe side: Roth IRA contributions (not growth), cash, and rules like regular early withdrawals from a 401(k) (72(t)) can also help, and aren't counted here. In today's dollars; age {ACCESS_AGE} is when the penalty ends.
      </Text>
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
      {step(2, "What your savings must pay", `${whole(b.need / 12)}/mo`,
        b.income > 0.5 || Math.abs(b.rentalIncome) > 0.5
          ? `Your ${whole(b.retireAnnual / 12)}/mo of spending, less the money that keeps coming in on its own (Social Security, pensions, rent).`
          : `Nothing else comes in (no Social Security, pension or rent entered), so your savings pay all ${whole(b.retireAnnual / 12)}/mo.`,
        <>
          {row("Retirement spending", per(b.retireAnnual))}
          {b.income - b.rentalIncome > 0.5 ? row("Social Security and pensions", `− ${per(b.income - b.rentalIncome)}`) : null}
          {Math.abs(b.rentalIncome) > 0.5 ? row("Rent you keep getting", `${b.rentalIncome >= 0 ? "−" : "+"} ${per(Math.abs(b.rentalIncome))}`, { sub: "Less a cushion for empty months" }) : null}
          <Divider />
          {row("Savings pay", per(b.need), { strong: true })}
          {link(b.income - b.rentalIncome > 0.5 ? "Change Social Security and pensions" : "Add Social Security or a pension", () => toView("retirement"))}
        </>)}
      {step(3, "Your FIRE number", whole(b.fire),
        `Two parts: enough that taking out ${rate(b.swr)} a year covers your spending for life, plus money set aside for costs that end (paid monthly from your savings until they stop).`,
        <>
          <Text style={[type.overline, { color: t.text3, marginTop: space.xs }]}>For spending that lasts</Text>
          {row(`${whole(b.need)} ÷ ${rate(b.swr)}`, whole(b.base), { sub: `What your savings pay a year, at a ${rate(b.swr)} withdrawal rate` })}
          {b.taxExtra > 0.5 ? row("Income tax on pre-tax money", `+ ${whole(b.taxExtra)}`, { sub: `${percent(d.taxRate)} tax on the ${percent(o.preShareFinal)} that's pre-tax` }) : null}
          {b.bridge + b.healthBridge + b.homeBridge > 0.5 ? (
            <Text style={[type.overline, { color: t.text3, marginTop: space.sm }]}>Set aside for costs that end</Text>
          ) : null}
          {b.bridge > 0.5 ? row("Until Social Security or a pension starts", `+ ${whole(b.bridge)}`, { sub: "Paid monthly from your savings until that income starts" }) : null}
          {b.healthBridge > 0.5 ? row("Health insurance until 65", `+ ${whole(b.healthBridge)}`, { sub: `${whole(state.healthcare)}/mo from ${d.retireAge} until Medicare, beyond Medicare's cost` }) : null}
          {o.mortgagesAtRetire.map((x) => (
            <View key={x.id}>
              {x.choice === "keep" && x.keepCost !== null && x.months !== null
                ? row(`Keep paying ${x.name || "the mortgage"}`, `+ ${whole(x.keepCost)}`, {
                    sub: `Set aside for its payments from ${d.retireAge} until it ends in ${monthLabel(start, Math.round(yearsToRetire * 12) + x.months)}; it keeps growing while it's paid out. Paying it off then: ${whole(x.payoffCost)}`,
                  })
                : row(`Pay off ${x.name || "the mortgage"} at ${d.retireAge}`, `+ ${whole(x.payoffCost)}`, {
                    sub: x.keepCost === null ? "Its payment never pays it off, so this pays off what's owed then" : `What's owed then. Keeping up the payments instead: ${whole(x.keepCost)}`,
                  })}
            </View>
          ))}
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
      {step(5, "What you're on track for", `${whole(b.planSupports / 12)}/mo`,
        onTrackWhy,
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
          {link("Mark what's essential", () => router.push("/emergency"))}
        </>
      ) : null}
    </Card>
  );

  return (
    <>
      {answer}
      {getThere}
      {beforeAccess}
      {breakdown}
      {ladder}
    </>
  );
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const styles = StyleSheet.create({
  split: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.xs },
  verdict: { borderRadius: radius.md, padding: space.md, gap: 4 },
  way: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: space.sm },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  cta: { borderRadius: radius.md, paddingVertical: 12, alignItems: "center", marginTop: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 3 },
  stepHead: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 36 },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  answers: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  answer: { flexGrow: 1, flexBasis: 220, borderRadius: radius.md, padding: space.md, gap: 2 },
  point: { flexDirection: "row", gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  stem: { width: 2, flex: 1, marginTop: 2 },
});
