import { describe, expect, it } from "vitest";
import {
  checksInMonth,
  coastNumberAt,
  DEFAULT_LIMITS,
  derive,
  isHighInterest,
  k401Cost,
  rateIn,
  setAsideFor,
  limitsFor,
  matchFor,
  project,
  resolveIncome,
  run,
  simulatePlan,
  type Income,
  type PlanState,
} from "../src";
import { sampleState, START } from "./fixtures";

const blank = (over: Partial<PlanState> = {}): PlanState => ({
  version: 2, age: 30, retireAge: 40, healthcare: 0, currentInvestMonthly: 0,
  incomes: [], budget: [], accounts: [], debts: [], goals: [], limits: [],
  plan: { steps: [], starterEF: 0, efMonths: 0, highApr: 0.07, marginalTax: 0, hsaEligible: false, hsaFamily: false, projectWith: "plan" },
  ret: 0.05, vol: 0.15, fee: 0, swr: 0.035, taxRate: 0, contribGrowth: 0,
  whatif: { extra: 0, retDelta: 0, spendDelta: 0 },
  ...over,
});

describe("PLAN.md §5.1 required tests", () => {
  it("coast <-> FIRE identity: coastNow x (1+r)^years === fire", () => {
    const res = run(sampleState(), START);
    expect(res.d.years).toBe(28);
    const back = res.coastNow * Math.pow(1 + res.d.r, res.d.years);
    expect(Math.abs(back - res.fire) / res.fire).toBeLessThan(1e-6);
  });

  it("annuity: $12k/yr pre-tax, 0 balance, 10 yrs, 6%, monthly = 162,473.44", () => {
    const s = blank({
      ret: 0.06,
      limits: DEFAULT_LIMITS,
      incomes: [{ id: "i", name: "Job", freq: "monthly", net: 0, matchMode: "usd", pretax: 1000, match: 0 }],
    });
    const d = derive(s, START);
    expect(d.years).toBe(10);
    const plan = simulatePlan(s, d);
    const proj = project(d, plan, 0.06);
    expect(proj.final).toBeCloseTo(162473.44, 2);
  });

  it("biweekly paydays from 2026-11-13", () => {
    const inc = { freq: "biweekly", nextPayday: "2026-11-13" } as const;
    const y2027 = Array.from({ length: 12 }, (_, m) => checksInMonth(inc, 2027, m));
    expect(y2027).toEqual([2, 2, 2, 3, 2, 2, 2, 2, 2, 3, 2, 2]);
    expect(y2027.reduce((a, b) => a + b, 0)).toBe(26);
    expect(checksInMonth(inc, 2026, 10)).toBe(2);
    expect(checksInMonth(inc, 2026, 11)).toBe(2);
  });

  it("other pay frequencies", () => {
    expect(checksInMonth({ freq: "monthly" }, 2027, 0)).toBe(1);
    expect(checksInMonth({ freq: "semimonthly" }, 2027, 0)).toBe(2);
    expect(checksInMonth({ freq: "weekly" }, 2027, 0)).toBeCloseTo(52 / 12);
    // Friday payer: 2028 is a normal 52-check year (four 5-check months);
    // 2027 starts on a Friday, so it really has 53 Fridays (five 5-check months).
    const weekly = (y: number) => Array.from({ length: 12 }, (_, m) => checksInMonth({ freq: "weekly", nextPayday: "2026-11-06" }, y, m));
    expect(weekly(2028).reduce((a, b) => a + b, 0)).toBe(52);
    expect(weekly(2028).filter((c) => c === 5)).toHaveLength(4);
    expect(weekly(2027).reduce((a, b) => a + b, 0)).toBe(53);
    expect(weekly(2027).filter((c) => c === 5)).toHaveLength(5);
  });

  it("match formula: gross 3500, 4%, 100% of 3% + 50% of 2%", () => {
    const inc: Income = {
      id: "i", name: "Job", freq: "biweekly", net: 2400, matchMode: "pct", gross: 3500, contribPct: 0.04,
      matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02,
    };
    const r = resolveIncome(inc);
    expect(r.pretax).toBeCloseTo(140, 9);
    expect(r.match).toBeCloseTo(122.5, 9);
    expect(r.maxPct).toBeCloseTo(0.05, 12);
    expect(r.gapPre).toBeCloseTo(35, 9);
    expect(r.gapMatch).toBeCloseTo(17.5, 9);
    expect(r.fullMatch).toBe(false);
    expect(matchFor(3500, 0.06, inc)).toBeCloseTo(140, 9);
  });

  it("usd mode passes through and reports no gap", () => {
    const r = resolveIncome({ id: "i", name: "J", freq: "monthly", net: 1, matchMode: "usd", pretax: 200, match: 100 });
    expect(r).toMatchObject({ pretax: 200, match: 100, fullMatch: true, gapPre: 0, gapMatch: 0, maxPct: null });
  });

  it("avalanche: the higher APR is paid off first", () => {
    const s = blank({
      incomes: [{ id: "i", name: "Job", freq: "monthly", net: 1000, matchMode: "usd" }],
      debts: [
        { id: "lo", name: "Low", balance: 3000, apr: 0.1, minPayment: 0 },
        { id: "hi", name: "High", balance: 3000, apr: 0.2, minPayment: 0 },
      ],
      plan: { ...blank().plan, steps: ["highDebt"] },
    });
    const plan = simulatePlan(s, derive(s, START));
    const hi = plan.events.find((e) => e.key === "debt:hi")!;
    const lo = plan.events.find((e) => e.key === "debt:lo")!;
    expect(hi.m).toBeLessThan(lo.m);
    expect(plan.events.find((e) => e.key === "debtFree")!.m).toBe(lo.m);
  });

  it("a 401(k) loan is never paid early as high-interest debt, whatever its rate", () => {
    const s = blank({
      incomes: [{ id: "i", name: "Job", freq: "monthly", net: 1000, matchMode: "usd" }],
      debts: [
        { id: "loan", name: "Loan", kind: "k401_loan", balance: 3000, apr: 0.09, minPayment: 0 },
        { id: "card", name: "Card", kind: "credit_card", balance: 3000, apr: 0.2, minPayment: 0 },
      ],
      plan: { ...blank().plan, steps: ["highDebt"] },
    });
    const plan = simulatePlan(s, derive(s, START));
    expect(plan.events.find((e) => e.key === "debt:card")).toBeDefined();
    expect(plan.events.find((e) => e.key === "debt:loan")).toBeUndefined();
    // the low-interest step does pay it down
    const low = blank({ ...s, plan: { ...s.plan, steps: ["highDebt", "lowDebt"] } });
    expect(simulatePlan(low, derive(low, START)).events.find((e) => e.key === "debt:loan")).toBeDefined();
    expect(isHighInterest({ kind: "k401_loan", apr: 0.5 }, 0.07)).toBe(false);
    expect(isHighInterest({ kind: "other", apr: 0.07 }, 0.07)).toBe(true);
  });

  it("determinism: same state + startDate gives identical output", () => {
    const a = run(sampleState(), START);
    const b = run(sampleState(), START);
    const strip = ({ whenBalance: _a, whenCoastPct: _b, ...rest }: ReturnType<typeof run>) => rest;
    expect(strip(a)).toEqual(strip(b));
    expect(a.mc.probFire).toBe(b.mc.probFire);
  });
});

describe("limits", () => {
  const rows = [
    { year: 2026, k401: 1, k401Catch: 0, ira: 1, iraCatch: 0, hsaSelf: 0, hsaFamily: 0, hsaCatch: 0 },
    { year: 2028, k401: 3, k401Catch: 0, ira: 3, iraCatch: 0, hsaSelf: 0, hsaFamily: 0, hsaCatch: 0 },
  ];
  it("exact, latest earlier, else earliest", () => {
    expect(limitsFor(rows, 2026).k401).toBe(1);
    expect(limitsFor(rows, 2027).k401).toBe(1);
    expect(limitsFor(rows, 2040).k401).toBe(3);
    expect(limitsFor(rows, 2020).k401).toBe(1);
    expect(limitsFor([], 2026).k401).toBe(0);
  });
});

describe("plan behavior", () => {
  it("first year caps are prorated by months left (Nov start = 2/12)", () => {
    const s = sampleState();
    const plan = simulatePlan(s, derive(s, START));
    const ira2026 = plan.months.filter((m) => m.y === 2026).reduce((a, m) => a + m.alloc.ira, 0);
    expect(ira2026).toBeLessThanOrEqual((7500 * 2) / 12 + 1e-6);
  });

  it("a negative month draws from cash and records the shortfall", () => {
    const s = blank({
      incomes: [{ id: "i", name: "Job", freq: "monthly", net: 1000, matchMode: "usd" }],
      budget: [{ id: "b", name: "Rent", amount: 1500, inRetirement: true }],
      accounts: [{ id: "c", name: "Cash", type: "cash", balance: 5000 }],
    });
    const m0 = simulatePlan(s, derive(s, START)).months[0]!;
    expect(m0.shortfall).toBe(500);
    expect(m0.cash).toBe(4500);
  });

  it("projectWith 'current' invests currentInvestMonthly (IRA first, then taxable)", () => {
    const s = blank({
      currentInvestMonthly: 700,
      limits: [{ year: 2026, k401: 0, k401Catch: 0, ira: 6000, iraCatch: 0, hsaSelf: 0, hsaFamily: 0, hsaCatch: 0 }],
      incomes: [{ id: "i", name: "Job", freq: "monthly", net: 3000, matchMode: "usd" }],
      plan: { ...blank().plan, projectWith: "current", steps: ["taxable"] },
    });
    const months = simulatePlan(s, derive(s, START)).months;
    // Nov 2026: prorated IRA cap = 1000 for the year
    expect(months[0]!.alloc).toMatchObject({ ira: 700, taxable: 0, leftover: 2300 });
    expect(months[1]!.alloc).toMatchObject({ ira: 300, taxable: 400 });
    // Jan 2027: full-year cap resets
    expect(months[2]!.alloc).toMatchObject({ ira: 700, taxable: 0 });
  });

  it("biweekly 3-check months are flagged as extra-paycheck months", () => {
    const s = sampleState();
    const months = simulatePlan(s, derive(s, START)).months;
    const flagged = months.filter((m) => m.y === 2027 && m.extraCheck).map((m) => m.mo);
    expect(flagged).toEqual([3, 9]);
  });

  describe("401(k) annual limit", () => {
    const k401State = (pretax: number, match = 0) =>
      blank({
        age: 32, retireAge: 60,
        incomes: [{ id: "i", name: "Job", freq: "monthly", net: 9000, matchMode: "usd", pretax, match }],
        budget: [{ id: "b", name: "Living", amount: 2000, inRetirement: true }],
        limits: [{ year: 2026, k401: 24500, k401Catch: 8000, ira: 7500, iraCatch: 1100, hsaSelf: 4400, hsaFamily: 8750, hsaCatch: 1000 }],
        plan: { ...blank().plan, marginalTax: 0.22, steps: ["k401", "taxable"] },
      });
    const year = (s: PlanState, y: number) => simulatePlan(s, derive(s, START)).months.filter((m) => m.y === y);

    it("waterfall leaves room for the rest of the year's payroll (prototype hit $38,000 here)", () => {
      const months = year(k401State(1500), 2027);
      const total = months.reduce((a, m) => a + m.payPre + m.alloc.k401, 0);
      expect(total).toBeCloseTo(24500, 6);
      expect(months.every((m) => m.payPre === 1500 && m.payCut === 0)).toBe(true);
      // the extra is front-loaded, never more than the room left after scheduled payroll
      expect(months[0]!.alloc.k401).toBeCloseTo(24500 - 18000, 6);
    });

    it("payroll alone over the limit stops deferring; match stops and the cut returns as take-home", () => {
      const months = year(k401State(3000, 1500), 2027);
      expect(months.reduce((a, m) => a + m.payPre, 0)).toBeCloseTo(24500, 6);
      // Jan-Aug full (24,000), Sep partial (500), Oct-Dec none
      expect(months.map((m) => Math.round(m.payPre))).toEqual([3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 500, 0, 0, 0]);
      const sep = months[8]!;
      expect(sep.payCut).toBeCloseTo(2500, 6);
      expect(sep.payMatch).toBeCloseTo(250, 6);
      expect(sep.income).toBeCloseTo(9000 + 2500 * (1 - 0.22), 6);
      expect(months.every((m) => m.alloc.k401 === 0)).toBe(true);
    });
  });

  it("coast curve ends at the FIRE number", () => {
    const res = run(sampleState(), START);
    expect(res.coastCurve.at(-1)).toBeCloseTo(res.fire, 6);
    expect(res.coastCurve[0]).toBeCloseTo(coastNumberAt(res.fire, res.d.r, res.d.years), 6);
  });
});

describe("snapshot: sample state", () => {
  it("headline numbers and plan events", () => {
    const res = run(sampleState(), START);
    expect({
      fire: Math.round(res.fire),
      coastNow: Math.round(res.coastNow),
      crossing: res.crossing,
      crossingC: res.crossingC,
      probFire: res.mc.probFire,
      probCoastNow: res.mc.probCoastNow,
      coastSoonerMonths: res.coastSoonerMonths,
      freedomDays: Math.round(res.freedomDays),
      events: res.plan.events,
      firstFund: res.plan.firstFund,
    }).toMatchSnapshot();
  });
});

describe("one-off adjustments and short months", () => {
  // Nov 2026 start; monthly job $5,000 take-home; $3,000 budget; $10,000 cash
  const base = (over: Partial<PlanState> = {}) =>
    blank({
      age: 32, retireAge: 60,
      incomes: [{ id: "i", name: "Job", freq: "monthly", net: 5000, matchMode: "usd" }],
      budget: [{ id: "b", name: "Living", amount: 3000, inRetirement: true }],
      accounts: [{ id: "c", name: "Cash", type: "cash", balance: 10000 }],
      limits: DEFAULT_LIMITS,
      plan: { ...blank().plan, steps: ["highDebt", "taxable"] },
      ...over,
    });
  const months = (s: PlanState) => simulatePlan(s, derive(s, START)).months;

  it("an unexpected expense only changes its own month", () => {
    const s = base({ adjustments: [{ id: "a", month: "2027-01", kind: "expense", amount: 1500, note: "Car repair" }] });
    const [nov, dec, jan, feb] = months(s);
    expect(jan!.adjExpense).toBe(1500);
    expect(jan!.expenses).toBe(4500);
    expect(jan!.alloc.taxable).toBe(500); // 5,000 − 3,000 − 1,500
    for (const m of [nov!, dec!, feb!]) expect(m.alloc.taxable).toBe(2000);
  });

  it("lost pay and a bonus change that month's income", () => {
    const s = base({
      adjustments: [
        { id: "l", month: "2026-12", kind: "incomeLoss", amount: 2000, note: "Unpaid week" },
        { id: "g", month: "2027-03", kind: "incomeGain", amount: 4000, note: "Bonus" },
      ],
    });
    const ms = months(s);
    expect(ms[1]!.income).toBe(3000);
    expect(ms[1]!.adjIncome).toBe(-2000);
    expect(ms[4]!.income).toBe(9000);
    expect(ms[4]!.alloc.taxable).toBe(6000);
  });

  it("a short month draws cash first, then goes on a card at your card's rate, which the plan pays off", () => {
    const s = base({
      debts: [{ id: "cc", name: "Visa", kind: "credit_card", balance: 0, apr: 0.25, minPayment: 0 }],
      adjustments: [{ id: "a", month: "2026-12", kind: "expense", amount: 14000, note: "Medical" }],
    });
    const plan = simulatePlan(s, derive(s, START));
    const dec = plan.months[1]!;
    // Dec: 5,000 in − 3,000 budget − 14,000 = −12,000; cash (10,000 + Nov's 0 left) covers 10,000
    expect(dec.shortfall).toBeCloseTo(12000, 6);
    expect(dec.cash).toBe(0);
    expect(dec.borrowed).toBeCloseTo(2000, 6);
    expect(plan.events.some((e) => e.key === "borrowed" && e.m === 1)).toBe(true);
    // high interest, so the highDebt step pays it down right away: Jan pays all but the
    // interest + minimum (2,000 × 25%/12 ≈ $42 left), Feb finishes it
    const jan = plan.months[2]!;
    expect(jan.alloc.debt).toBeGreaterThan(1900);
    expect(jan.debtTotal).toBeCloseTo((2000 * 0.25) / 12, 6);
    expect(plan.events.find((e) => e.key === "debt:shortfall")?.m).toBe(3);
  });

  it("without a credit card listed, borrowing uses a typical 22% rate", () => {
    const s = base({ accounts: [], adjustments: [{ id: "a", month: "2026-11", kind: "expense", amount: 3000, note: "" }] });
    const nov = months(s)[0]!;
    expect(nov.borrowed).toBeCloseTo(1000, 6);
    // interest + 2% minimum the next month: 1,000 × (1 + 0.22/12) then pays max(25, 2%)
    const dec = months(s)[1]!;
    expect(dec.minPay).toBeCloseTo(Math.max(25, 1000 * (1 + 0.22 / 12) * 0.02), 6);
  });
});

describe("emergency mode", () => {
  // Nov 2026 start; $5,000 take-home; budget $2,000 essential + $1,000 non-essential; payroll 401(k) $400 + $200 match
  const base = (emergency?: PlanState["emergency"]) =>
    blank({
      age: 32, retireAge: 60,
      incomes: [{ id: "i", name: "Job", freq: "monthly", net: 5000, matchMode: "usd", pretax: 400, match: 200 }],
      budget: [
        { id: "rent", name: "Rent", amount: 2000, inRetirement: true },
        { id: "fun", name: "Fun", amount: 1000, inRetirement: true, essential: false },
      ],
      accounts: [{ id: "c", name: "Cash", type: "cash", balance: 1000 }],
      limits: DEFAULT_LIMITS,
      plan: { ...blank().plan, marginalTax: 0.2, steps: ["starterEF", "taxable"], starterEF: 500 },
      emergency,
    });
  const months = (s: PlanState) => simulatePlan(s, derive(s, START)).months;

  it("off: the normal plan runs", () => {
    const m = months(base())[0]!;
    expect(m.emergency).toBe(false);
    expect(m.alloc.taxable).toBe(2000);
  });

  it("on: everything left over stays in cash through the end month, then the plan resumes", () => {
    const ms = months(base({ active: true, until: "2026-12", essentialsOnly: false, pause401k: false }));
    for (const m of ms.slice(0, 2)) {
      expect(m.emergency).toBe(true);
      expect(m.alloc.taxable + m.alloc.ira + m.alloc.debt + m.alloc.goals + m.alloc.k401 + m.alloc.ef).toBe(0);
      expect(m.alloc.leftover).toBe(2000);
    }
    expect(ms[1]!.cash).toBe(5000);
    expect(ms[2]!.emergency).toBe(false);
    expect(ms[2]!.alloc.taxable).toBe(2000);
  });

  it("cutting to essentials drops non-essential items from expenses", () => {
    const m = months(base({ active: true, until: "2026-11", essentialsOnly: true, pause401k: false }))[0]!;
    expect(m.expenses).toBe(2000);
    expect(m.alloc.leftover).toBe(3000);
  });

  it("pausing the 401(k) returns it to take-home after tax and stops the match", () => {
    const m = months(base({ active: true, until: "2026-11", essentialsOnly: false, pause401k: true }))[0]!;
    expect(m.payPre).toBe(0);
    expect(m.payMatch).toBe(0);
    expect(m.income).toBeCloseTo(5000 + 400 * 0.8, 6);
  });

  it("runway counts essentials and debt minimums", () => {
    const d = derive(base(), START);
    expect(d.essentialExpenses).toBe(2000);
    expect(d.runwayEssential).toBeCloseTo(0.5, 9);
    expect(d.emergencyMonths).toBeCloseTo(1000 / 3000, 9);
  });

  it("inactive emergency settings change nothing", () => {
    const off = run(base(), START);
    const inactive = run(base({ active: false, until: "2027-06", essentialsOnly: true, pause401k: true }), START);
    expect(inactive.fire).toBe(off.fire);
    expect(inactive.projectedFinal).toBe(off.projectedFinal);
  });
});

describe("retirement income, promo rates, minimum-only debts, employer HSA, Roth 401(k)", () => {
  const job = { id: "i", name: "Job", freq: "monthly" as const, net: 2000, matchMode: "usd" as const };
  const spending = [{ id: "b", name: "Life", amount: 4000, inRetirement: true }];

  it("Social Security lowers the FIRE number; income starting later is bridged from savings", () => {
    const base = blank({ age: 40, retireAge: 60, budget: spending, swr: 0.04 });
    const none = run(base, START).fire; // 48,000 / 4% = 1.2M
    expect(none).toBeCloseTo(1_200_000, 6);
    // $2,000/mo from 60: covers half → 600k
    const atRetire = run({ ...base, retirementIncome: [{ id: "ss", name: "SS", kind: "socialSecurity", monthly: 2000, startAge: 60 }] }, START).fire;
    expect(atRetire).toBeCloseTo(600_000, 6);
    // same income from 67: 600k + 7 years × 24k bridge
    const later = run({ ...base, retirementIncome: [{ id: "ss", name: "SS", kind: "socialSecurity", monthly: 2000, startAge: 67 }] }, START).fire;
    expect(later).toBeCloseTo(600_000 + 7 * 24_000, 6);
    // income larger than spending can't go below zero (only the bridge remains)
    const big = run({ ...base, retirementIncome: [{ id: "p", name: "Pension", kind: "pension", monthly: 9000, startAge: 62 }] }, START).fire;
    expect(big).toBeCloseTo(2 * 108_000, 6);
  });

  it("a 0% promo charges no interest until it ends; the avalanche pays the card charging interest now first", () => {
    const s = blank({
      incomes: [{ ...job, net: 500 }],
      debts: [
        { id: "promo", name: "Promo", kind: "credit_card", balance: 3000, apr: 0.25, minPayment: 0, promoApr: 0, promoUntil: "2027-06" },
        { id: "card", name: "Card", kind: "credit_card", balance: 3000, apr: 0.2, minPayment: 0 },
      ],
      plan: { ...blank().plan, steps: ["highDebt"] },
    });
    const plan = simulatePlan(s, derive(s, START));
    const promoPaid = plan.events.find((e) => e.key === "debt:promo")!;
    const cardPaid = plan.events.find((e) => e.key === "debt:card")!;
    expect(cardPaid.m).toBeLessThan(promoPaid.m);
    // nothing paid on the promo card in month 0 and it grew no interest
    const s2 = { ...s, debts: [s.debts[0]!], plan: { ...s.plan, steps: [] } };
    const p2 = simulatePlan(s2, derive(s2, START));
    expect(p2.months[0]!.debtTotal).toBeCloseTo(3000, 9);
    expect(rateIn(s.debts[0]!, "2027-06")).toBe(0);
    expect(rateIn(s.debts[0]!, "2027-07")).toBe(0.25);
  });

  it("minimum-only debts get no extra payments", () => {
    const s = blank({
      incomes: [{ ...job, net: 1000 }],
      debts: [{ id: "sl", name: "Federal loans", kind: "student", balance: 5000, apr: 0.06, minPayment: 0, minimumOnly: true }],
      plan: { ...blank().plan, steps: ["highDebt", "lowDebt"] },
    });
    const plan = simulatePlan(s, derive(s, START));
    expect(plan.months[0]!.alloc.debt).toBe(0);
    expect(plan.events.find((e) => e.key === "debt:sl")).toBeUndefined();
  });

  it("employer HSA money is invested and counts toward the HSA limit", () => {
    const s = blank({
      limits: DEFAULT_LIMITS,
      incomes: [{ ...job, hsaEmployer: 1200 }],
      plan: { ...blank().plan, hsaEligible: true, steps: ["hsa"] },
    });
    const plan = simulatePlan(s, derive(s, START));
    const m1 = plan.months.find((m) => m.y === 2027 && m.mo === 0)!; // January, a fresh year
    expect(m1.payHsaEmployer).toBeCloseTo(100, 9);
    expect(m1.post).toBeGreaterThanOrEqual(100);
    const year = plan.months.filter((m) => m.y === 2027);
    const L = DEFAULT_LIMITS.find((l) => l.year === 2027) ?? DEFAULT_LIMITS.at(-1)!;
    const total = year.reduce((a, m) => a + m.payHsaEmployer + m.alloc.hsa, 0);
    expect(total).toBeLessThanOrEqual(L.hsaSelf + 1e-6);
  });

  it("payroll steps add a steady amount per check (no December lump sum), after what you already put in", () => {
    const rich = { ...job, net: 20000 };
    const base = { limits: DEFAULT_LIMITS, plan: { ...blank().plan, steps: ["k401" as const] } };
    const lump = simulatePlan(blank({ ...base, incomes: [rich] }), derive(blank({ ...base, incomes: [rich] }), START)).months[0]!;
    const s = blank({ ...base, incomes: [rich], plan: { ...base.plan, payrollSteps: true } });
    const m0 = simulatePlan(s, derive(s, START)).months[0]!;
    const L = DEFAULT_LIMITS.find((l) => l.year === 2026)!;
    expect(lump.alloc.k401).toBeGreaterThan(L.k401 / 12 + 1); // old behavior: the rest of the year at once
    expect(m0.alloc.k401).toBeCloseTo(L.k401 / 12, 6); // one monthly check: a twelfth of the limit
    // your own payroll 401(k) counts first
    const withPre = blank({ ...base, incomes: [{ ...rich, pretax: 1500 }], plan: { ...base.plan, payrollSteps: true } });
    expect(simulatePlan(withPre, derive(withPre, START)).months[0]!.alloc.k401).toBeCloseTo(L.k401 / 12 - 1500, 6);
  });

  it("your own payroll HSA counts toward the limit; a payroll HSA step tops it up per check, pre-tax", () => {
    const s = blank({
      limits: DEFAULT_LIMITS,
      incomes: [{ ...job, net: 20000, hsaPre: 200 }],
      plan: { ...blank().plan, marginalTax: 0.2, hsaEligible: true, steps: ["hsa"], payrollSteps: true, hsaPayroll: true },
    });
    const jan = simulatePlan(s, derive(s, START)).months.find((m) => m.y === 2027 && m.mo === 0)!;
    const L = DEFAULT_LIMITS.find((l) => l.year === 2027)!;
    expect(jan.payHsa).toBeCloseTo(200, 9);
    expect(jan.alloc.hsa).toBeCloseTo(L.hsaSelf / 12 - 200, 6);
    expect(jan.post).toBeCloseTo(L.hsaSelf / 12, 6);
    // a pre-tax dollar costs 80¢ of take-home: the rest of the check goes on as leftover
    expect(jan.alloc.leftover).toBeCloseTo(20000 - (L.hsaSelf / 12 - 200) * 0.8, 6);
  });

  it("a step with a share runs alongside the next one", () => {
    const s = blank({
      incomes: [{ ...job, net: 10000 }],
      budget: spending,
      plan: { ...blank().plan, efMonths: 6, steps: ["fullEF", "taxable"], shares: { fullEF: 0.7 } },
    });
    const m0 = simulatePlan(s, derive(s, START)).months[0]!;
    expect(m0.alloc.ef).toBeCloseTo(6000 * 0.7, 6);
    expect(m0.alloc.taxable).toBeCloseTo(6000 * 0.3, 6);
  });

  it("a step with a set amount a month gets that much (or a changed month's amount); the rest goes on", () => {
    const s = blank({
      incomes: [{ ...job, net: 10000 }],
      budget: spending,
      plan: { ...blank().plan, efMonths: 6, steps: ["fullEF", "taxable"], amounts: { fullEF: 2500 }, amountsBy: { fullEF: { "2026-12": 500 } } },
    });
    const [nov, dec] = simulatePlan(s, derive(s, START)).months;
    expect(nov!.alloc.ef).toBeCloseTo(2500, 6);
    expect(nov!.alloc.taxable).toBeCloseTo(6000 - 2500, 6);
    expect(dec!.alloc.ef).toBeCloseTo(500, 6);
    expect(dec!.alloc.taxable).toBeCloseTo(6000 - 500, 6);
  });

  it("a month changed by hand goes first, even for a later step", () => {
    const s = blank({
      limits: DEFAULT_LIMITS,
      incomes: [{ ...job, net: 10000 }],
      budget: spending,
      plan: { ...blank().plan, efMonths: 6, steps: ["fullEF", "ira", "taxable"], amountsBy: { ira: { "2026-11": 1000 } } },
    });
    const [nov, dec] = simulatePlan(s, derive(s, START)).months;
    expect(nov!.alloc.ira).toBeCloseTo(1000, 6);
    expect(nov!.alloc.ef).toBeCloseTo(5000, 6);
    expect(dec!.alloc.ira).toBe(0);
  });

  it("payroll steps don't shrink this year's 401(k) limit: earlier paychecks count instead", () => {
    // starts in November: Jan–Oct paychecks are assumed to have gone in at today's amount
    const s = blank({ limits: DEFAULT_LIMITS, incomes: [{ ...job, net: 8000, pretax: 2000 }], plan: { ...blank().plan, payrollSteps: true } });
    const p = simulatePlan(s, derive(s, START));
    expect(p.ytdBefore?.k401).toBeCloseTo(20000, 9);
    expect(p.months[0]!.payCut).toBe(0);
    expect(p.months[1]!.payCut).toBe(0);
    // a step starting in December gets the rest of the real yearly limit, not a prorated sliver
    const L = DEFAULT_LIMITS.find((l) => l.year === 2026)!;
    expect(p.months[1]!.payPre).toBeCloseTo(2000, 9);
    expect(20000 + 4000).toBeLessThanOrEqual(L.k401);
  });

  it("Roth 401(k) contributions go to the after-tax bucket and cost a full dollar", () => {
    const pre = blank({ limits: DEFAULT_LIMITS, incomes: [{ ...job, pretax: 500 }] });
    const roth = blank({ limits: DEFAULT_LIMITS, incomes: [{ ...job, pretax: 500, rothShare: 1 }] });
    const a = simulatePlan(pre, derive(pre, START)).months[0]!;
    const b = simulatePlan(roth, derive(roth, START)).months[0]!;
    expect(a.pre).toBeCloseTo(500, 9);
    expect(b.pre).toBeCloseTo(0, 9);
    expect(b.post).toBeCloseTo(500, 9);
    expect(b.payRoth).toBeCloseTo(500, 9);
    expect(k401Cost(0.25, 0)).toBe(0.75);
    expect(k401Cost(0.25, 1)).toBe(1);
    expect(k401Cost(0.25, 0.5)).toBeCloseTo(0.875, 12);
  });
});

describe("payroll-repaid debts (paycheck 401(k) loans)", () => {
  it("pay down without coming out of the budget, and the money comes back once paid off", () => {
    const s = blank({
      incomes: [{ id: "i", name: "Job", freq: "monthly", net: 3000, matchMode: "usd" }],
      debts: [{ id: "k", name: "401(k) loan", kind: "k401_loan", balance: 1000, apr: 0, minPayment: 300, payroll: true }],
    });
    const d = derive(s, START);
    expect(d.debtMins).toBe(0);
    const plan = simulatePlan(s, d);
    expect(plan.months[0]!.minPay).toBe(0);
    expect(plan.months[0]!.income).toBe(3000);
    expect(plan.months[3]!.income).toBeCloseTo(3000 + 200, 9); // last payment is 100 of the 300
    expect(plan.months[4]!.income).toBeCloseTo(3300, 9);
    expect(plan.events.find((e) => e.key === "debt:k")!.m).toBe(3);
  });
});

describe("recurring goals (holidays, yearly bills)", () => {
  const base = (over: Partial<PlanState> = {}) =>
    blank({ incomes: [{ id: "i", name: "Job", freq: "monthly", net: 3000, matchMode: "usd" }], ...over });

  it("sets aside an equal share each month and spends it when due", () => {
    // START is Nov 2026; due Dec 2026 with $1,200 and nothing saved → catch up over 2 months
    const s = base({ goals: [{ id: "x", name: "Christmas", target: 1200, saved: 0, recurring: { every: 12, due: "2026-12" } }] });
    const plan = simulatePlan(s, derive(s, START));
    expect(plan.months[0]!.setAside).toBeCloseTo(600, 9); // Nov: 1200 / 2 months left
    expect(plan.months[0]!.setAsideBy.x).toBeCloseTo(600, 9);
    expect(plan.months[2]!.setAsideBy.x).toBeCloseTo(100, 9);
    expect(plan.months[1]!.setAside).toBeCloseTo(600, 9); // Dec: the rest, then it's spent
    expect(plan.months[2]!.setAside).toBeCloseTo(100, 9); // from Jan: 1200 / 12 toward next Dec
    expect(plan.months[0]!.expenses).toBeCloseTo(600, 9);
    expect(plan.months[2]!.goals.find((g) => g.id === "x")!.saved).toBeCloseTo(100, 9);
  });

  it("saving ahead lowers later months; it's never a waterfall step or a 'reached' event", () => {
    const s = base({
      goals: [{ id: "x", name: "Trip", target: 1200, saved: 600, recurring: { every: 12, due: "2027-10" } }],
      plan: { ...blank().plan, steps: ["goal:x", "taxable"] },
    });
    const plan = simulatePlan(s, derive(s, START));
    expect(plan.months[0]!.setAside).toBeCloseTo(600 / 12, 9); // 600 left over 12 months (Nov..Oct)
    expect(plan.months[0]!.alloc.goals).toBe(0);
    expect(plan.events.some((e) => e.key === "goal:x")).toBe(false);
  });

  it("adds to monthly costs and (unless turned off) to retirement spending", () => {
    const g = { id: "x", name: "Insurance", target: 600, saved: 0, recurring: { every: 6, due: "2027-03" } };
    const on = derive(base({ goals: [g] }), START);
    expect(on.setAsideMonthly).toBe(100);
    expect(on.monthlyExpenses).toBe(100);
    expect(on.retireMonthly).toBe(100);
    const off = derive(base({ goals: [{ ...g, recurring: { ...g.recurring, inRetirement: false } }] }), START);
    expect(off.retireMonthly).toBe(0);
  });
});

describe("setAsideFor", () => {
  it("is what's still needed ÷ months left, and rolls past due dates forward", () => {
    const g = { target: 1200, saved: 0, recurring: { every: 12, due: "2026-12" } };
    expect(setAsideFor(g, "2026-11")).toBe(600);
    expect(setAsideFor({ ...g, saved: 300 }, "2026-11")).toBe(450);
    expect(setAsideFor(g, "2027-01")).toBeCloseTo(100, 9); // next due Dec 2027
    expect(setAsideFor({ target: 139, saved: 0, recurring: { every: 12, due: "2027-10" } }, "2026-11")).toBeCloseTo(139 / 12, 9);
    expect(setAsideFor({ target: 500, saved: 0 }, "2026-11")).toBe(0);
  });
});

describe("recurring goal already set aside this month", () => {
  it("sets nothing aside through paidThrough, then resumes with what's left", () => {
    const g = { target: 1200, saved: 100, recurring: { every: 12, due: "2027-10", paidThrough: "2026-11" } };
    expect(setAsideFor(g, "2026-11")).toBe(0);
    // Dec 2026 → Oct 2027 is 11 months: (1200 − 100) / 11
    expect(setAsideFor(g, "2026-12")).toBeCloseTo(100, 9);
  });
});

describe("contributions already made this year, and the April 15 deadline", () => {
  const L = limitsFor(DEFAULT_LIMITS, 2026);
  const base = (over: Partial<PlanState> = {}) =>
    blank({ limits: DEFAULT_LIMITS, incomes: [{ id: "i", name: "Job", freq: "monthly", net: 1000, matchMode: "usd" }], plan: { ...blank().plan, steps: ["ira"] }, ...over });

  it("without it, the first year is prorated by months left (unchanged)", () => {
    const s = base({ incomes: [{ id: "i", name: "Job", freq: "monthly", net: 20000, matchMode: "usd" }] });
    const plan = simulatePlan(s, derive(s, START)); // Nov: 2/12 of the limit
    expect(plan.months[0]!.alloc.ira).toBeCloseTo((L.ira * 2) / 12, 6);
  });

  it("with it, the exact room left can all go in now", () => {
    const s = base({ incomes: [{ id: "i", name: "Job", freq: "monthly", net: 20000, matchMode: "usd" }], contributed: { year: 2026, k401: 0, ira: 5000, hsa: 0 } });
    const plan = simulatePlan(s, derive(s, START));
    expect(plan.months[0]!.alloc.ira).toBeCloseTo(L.ira - 5000, 6);
    expect(plan.months[1]!.alloc.ira).toBe(0);
  });

  it("unused IRA room for last year is filled January–April, before this year's", () => {
    const s = base({ contributed: { year: 2026, k401: 0, ira: 0, hsa: 0 } });
    const plan = simulatePlan(s, derive(s, START));
    const jan = plan.months[2]!; // Jan 2027
    expect(jan.alloc.ira).toBeCloseTo(1000, 6);
    expect(jan.priorIra).toBeCloseTo(1000, 6); // still 2026's room
    const may = plan.months[6]!; // May 2027: the deadline has passed
    expect(may.priorIra).toBe(0);
    expect(may.alloc.ira).toBeCloseTo(1000, 6);
  });

  it("starting in Jan–Apr with last year's amounts: that room is used first", () => {
    const feb = new Date(2027, 1, 10);
    const s = base({ contributed: { year: 2026, k401: 0, ira: 7000, hsa: 0 } });
    const plan = simulatePlan(s, derive(s, feb));
    expect(plan.months[0]!.priorIra).toBeCloseTo(L.ira - 7000, 6);
  });
});
