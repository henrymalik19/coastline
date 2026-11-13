import { describe, expect, it } from "vitest";
import { amortize, derive, loanSchedule, run, scheduledPayment, type Debt, type PlanState } from "../src";
import { START } from "./fixtures";

const blank = (over: Partial<PlanState> = {}): PlanState => ({
  version: 2, age: 50, retireAge: 60, healthcare: 0, currentInvestMonthly: 0,
  incomes: [{ id: "j", name: "Job", freq: "monthly", net: 9000, matchMode: "usd" }],
  budget: [{ id: "f", name: "Food", amount: 1000, inRetirement: true }],
  accounts: [], debts: [], goals: [], limits: [],
  plan: { steps: ["taxable"], starterEF: 0, efMonths: 0, highApr: 0.07, marginalTax: 0, hsaEligible: false, hsaFamily: false, projectWith: "plan" },
  ret: 0.05, vol: 0.15, fee: 0, swr: 0.04, taxRate: 0, contribGrowth: 0,
  whatif: { extra: 0, retDelta: 0, spendDelta: 0 },
  ...over,
});

const mortgage = (over: Partial<Debt> = {}): Debt => ({ id: "m", name: "Home", kind: "mortgage", balance: 200_000, apr: 0.06, minPayment: 1_699.1, minimumOnly: true, ...over });

describe("mortgages in retirement", () => {
  it("amortizes: a 30-year $250k loan at 6% takes 360 payments of about $1,499", () => {
    const pay = scheduledPayment(250_000, 0.06, 360);
    expect(pay).toBeCloseTo(1498.88, 1);
    expect(amortize(250_000, 0.06, pay).months).toBe(360);
    expect(amortize(1000, 0.12, 5).months).toBeNull(); // the payment doesn't cover the interest
  });

  it("a mortgage paid off before you retire adds nothing to your number", () => {
    const s = blank({ debts: [mortgage({ balance: 50_000 })] });
    const o = run(s, START);
    expect(o.mortgagesAtRetire).toEqual([]);
    expect(o.homeBridge).toBe(0);
    expect(o.fire).toBeCloseTo(run(blank(), START).fire, 6);
  });

  it("one that runs past retirement adds what's still owed then to your number", () => {
    // ~$200k left at 6% with $1,699 a month: about 15 years, so ~5 years into retirement
    const s = blank({ debts: [mortgage()] });
    const o = run(s, START);
    expect(o.mortgagesAtRetire).toHaveLength(1);
    const left = o.mortgagesAtRetire[0]!;
    expect(left.months).toBeGreaterThan(50);
    expect(left.months).toBeLessThan(70);
    expect(o.homeBridge).toBeCloseTo(left.balance, 6);
    expect(o.fire - run(blank(), START).fire).toBeCloseTo(left.balance, 0);
    // keeping up the monthly payments instead costs more in all (interest)
    expect(left.total).toBeGreaterThan(left.balance);
  });

  it("escrow isn't part of the loan, and keeps counting in retirement", () => {
    const s = blank({ debts: [mortgage({ minPayment: 2_099.1, escrow: 400 })] });
    const o = run(s, START);
    expect(o.mortgagesAtRetire[0]!.balance).toBeCloseTo(run(blank({ debts: [mortgage()] }), START).mortgagesAtRetire[0]!.balance, 6);
    expect(o.d.retireMonthly).toBeCloseTo(1400, 6);
  });

  it("paying extra through the plan shrinks what's left at retirement", () => {
    const base = blank({ debts: [mortgage()] });
    const extra = blank({ debts: [mortgage({ minimumOnly: undefined })], plan: { ...base.plan, steps: ["lowDebt", "taxable"] } });
    expect(run(extra, START).homeBridge).toBeLessThan(run(base, START).homeBridge);
  });

  it("a paid-off home's tax, insurance and upkeep count in retirement", () => {
    const s = blank({ accounts: [{ id: "h", name: "Home", type: "property", balance: 400_000, homeCosts: 6_000, upkeep: 0.01 }] });
    const d = derive(s, START);
    expect(d.homeMonthly).toBeCloseTo((6_000 + 4_000) / 12, 6);
    expect(d.retireMonthly).toBeCloseTo(1000 + 10_000 / 12, 6);
  });
});

describe("loan schedule", () => {
  it("shows the payment number and how far ahead of schedule extra payments put you", () => {
    const pay = scheduledPayment(250_000, 0.06, 360);
    // 48 payments made (first in Nov 2022); on schedule you'd owe about $236k
    const onTrack = { ...mortgage(), balance: 0, minPayment: pay, term: 360, firstPayment: "2022-11", original: 250_000 };
    const plain = loanSchedule(onTrack, "2026-11")!;
    expect(plain.paymentNumber).toBe(49);
    expect(plain.scheduledEnd).toBe("2052-10");
    const owed = plain.expectedBalance!;
    expect(owed).toBeGreaterThan(230_000);
    expect(owed).toBeLessThan(240_000);
    expect(Math.abs(loanSchedule({ ...onTrack, balance: owed }, "2026-11")!.aheadMonths!)).toBeLessThanOrEqual(1);
    // $30k less than the schedule says: years ahead
    const ahead = loanSchedule({ ...onTrack, balance: owed - 30_000 }, "2026-11")!;
    expect(ahead.aheadMonths!).toBeGreaterThan(36);
    expect(ahead.actualEnd! < plain.scheduledEnd).toBe(true);
    expect(loanSchedule(mortgage(), "2026-11")).toBeNull(); // no term or first payment
  });
});

describe("rentals and healthcare", () => {
  it("a rental's escrow and what's owed in retirement aren't your spending", () => {
    const own = blank({ debts: [mortgage({ minPayment: 2_099.1, escrow: 400 })] });
    const rental = blank({ debts: [mortgage({ minPayment: 2_099.1, escrow: 400, rental: true })] });
    const a = run(own, START);
    const b = run(rental, START);
    expect(a.d.retireMonthly - b.d.retireMonthly).toBeCloseTo(400, 6);
    expect(b.mortgagesAtRetire).toEqual([]);
    expect(b.homeBridge).toBe(0);
    expect(b.d.monthlyExpenses).toBeCloseTo(a.d.monthlyExpenses, 6); // still a payment today
  });

  it("health insurance until 65, then Medicare", () => {
    const s = blank({ age: 50, retireAge: 60, healthcare: 2_000, medicare: 500 });
    const d = derive(s, START);
    expect(d.healthRetired).toBe(500);
    expect(d.healthBridge).toBeCloseTo((2_000 - 500) * 12 * 5, 6);
    expect(d.retireMonthly).toBeCloseTo(1_000 + 500, 6);
    // retiring at 65 or later: Medicare only
    expect(derive({ ...s, age: 60, retireAge: 66 }, START).healthBridge).toBe(0);
    // no Medicare amount: the old way, healthcare for all of retirement
    expect(derive({ ...s, medicare: undefined }, START).retireMonthly).toBeCloseTo(3_000, 6);
  });
});

describe("properties", () => {
  it("a rental property's mortgage and escrow stay out of your number; a home's costs count", () => {
    const debt = mortgage({ minPayment: 2_099.1, escrow: 400 });
    const asRental = blank({ debts: [debt], properties: [{ id: "p", name: "Rental", kind: "rental", value: 300_000, mortgageId: "m", taxInsurance: 5_000, upkeep: 0.01 }] });
    const asHome = blank({ debts: [debt], properties: [{ id: "p", name: "Home", kind: "home", value: 300_000, mortgageId: "m", upkeep: 0.01 }] });
    const r = run(asRental, START);
    const h = run(asHome, START);
    expect(r.mortgagesAtRetire).toEqual([]);
    expect(r.d.retireMonthly).toBeCloseTo(1_000, 6); // only food: the rent pays the rest
    expect(h.mortgagesAtRetire).toHaveLength(1);
    expect(h.d.retireMonthly).toBeCloseTo(1_000 + 400 + 3_000 / 12, 6); // escrow + upkeep
    expect(r.d.bal.property).toBe(300_000); // counts in net worth either way
  });
});

describe("rentals in retirement", () => {
  // $1,500 a month in rent (after property costs), a mortgage with $300 escrow still owed when you retire
  const rentInc = { id: "r", name: "Rent", kind: "rental" as const, freq: "monthly" as const, net: 1_500, matchMode: "usd" as const };
  const loan = mortgage({ id: "rm", name: "Rental loan", balance: 250_000, minPayment: 1_799.1, escrow: 300 });
  const prop = { id: "p", name: "Rental", kind: "rental" as const, value: 300_000, mortgageId: "rm", incomeId: "r" };
  const withRental = (p: Partial<typeof prop> & { inRetirement?: boolean; vacancy?: number } = {}) =>
    blank({ incomes: [...blank().incomes, rentInc], budget: [{ id: "f", name: "Food", amount: 3000, inRetirement: true }], debts: [loan], properties: [{ ...prop, ...p }] });

  it("what's left of the rent counts as income in retirement: rent − 5% cushion − escrow", () => {
    const o = run(withRental(), START);
    expect(o.d.rentals).toHaveLength(1);
    expect(o.d.rentals[0]!.monthly).toBeCloseTo(1_500 - 75 - 300, 6);
    expect(o.d.rentalIncomeAnnual).toBeCloseTo((1_500 - 75 - 300) * 12, 6);
    expect(o.d.retireIncomeAnnual).toBeCloseTo((1_500 - 75 - 300) * 12, 6);
    // its escrow isn't counted twice: it's out of the rent, not in your spending
    expect(o.d.retireMonthly).toBeCloseTo(3_000, 6);
  });

  it("the loan still owed when you retire counts in your number, like a home's", () => {
    const o = run(withRental(), START);
    expect(o.mortgagesAtRetire.map((x) => x.id)).toEqual(["rm"]);
    expect(o.homeBridge).toBeGreaterThan(0);
  });

  it("the rent lowers your number by what it covers, less the loan owed (spending above the rent here)", () => {
    const kept = run(withRental(), START);
    const sold = run(withRental({ inRetirement: false }), START);
    const rentCovers = (1_500 - 75 - 300) * 12 / 0.04;
    expect(sold.fire - kept.fire).toBeCloseTo(rentCovers - kept.homeBridge, 0);
  });

  it("sold before you retire: no rent then, and its loan stays out of your number", () => {
    const o = run(withRental({ inRetirement: false }), START);
    expect(o.d.rentals).toEqual([]);
    expect(o.d.retireIncomeAnnual).toBe(0);
    expect(o.mortgagesAtRetire).toEqual([]);
  });

  it("the cushion can change, and a rental with no rent isn't counted", () => {
    expect(run(withRental({ vacancy: 0.1 }), START).d.rentals[0]!.monthly).toBeCloseTo(1_500 - 150 - 300, 6);
    const noRent = blank({ debts: [loan], properties: [{ ...prop, incomeId: undefined }] });
    const o = run(noRent, START);
    expect(o.d.rentals).toEqual([]);
    expect(o.mortgagesAtRetire).toEqual([]);
  });
});

describe("rent from your home in retirement (a basement)", () => {
  const rentInc = { id: "r", name: "Basement", kind: "rental" as const, freq: "monthly" as const, net: 1_200, matchMode: "usd" as const };
  const loan = mortgage({ id: "hm", name: "Home loan", balance: 300_000, minPayment: 2_500, escrow: 600 });
  const home = (inRetirement?: boolean) =>
    blank({ incomes: [...blank().incomes, rentInc], budget: [{ id: "f", name: "Food", amount: 3000, inRetirement: true }], debts: [loan], properties: [{ id: "h", name: "Home", kind: "home", value: 500_000, mortgageId: "hm", incomeId: "r", ...(inRetirement === undefined ? {} : { inRetirement }) }] });

  it("doesn't count after you retire unless you say so", () => {
    expect(run(home(), START).d.rentals).toEqual([]);
    expect(run(home(), START).d.retireIncomeAnnual).toBe(0);
  });

  it("when you'll keep renting it: rent less the cushion (the home's escrow is your spending already)", () => {
    const kept = run(home(true), START);
    const not = run(home(), START);
    expect(kept.d.rentals).toHaveLength(1);
    expect(kept.d.rentals[0]!.kind).toBe("home");
    expect(kept.d.rentals[0]!.escrow).toBe(0);
    expect(kept.d.rentals[0]!.monthly).toBeCloseTo(1_200 * 0.95, 6);
    expect(kept.d.retireMonthly).toBeCloseTo(not.d.retireMonthly, 6); // escrow still in spending
    expect(kept.homeBridge).toBeCloseTo(not.homeBridge, 6); // the home's loan counts either way
    expect(not.fire - kept.fire).toBeCloseTo((1_200 * 0.95 * 12) / 0.04, 0);
  });
});
