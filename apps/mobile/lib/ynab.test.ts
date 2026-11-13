import { budgetView, registerBalance, type PlanState } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { freshPlan } from "./presets";
import { cardMap } from "./register";
import { buildImport, categoryKey, dateParser, money, monthOf, parseCsv, parseYnab, suggestChoice, ynabAccounts, ynabCategories } from "./ynab";

// a small YNAB export, in the shape YNAB writes it (newest first, US dates, $ amounts)
const REGISTER = `﻿"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"
"Checking","","11/05/2026","Target","","","","Split (1/2) food","$70.00","$0.00","Cleared"
"Checking","","11/05/2026","Target","","","","Split (2/2) stuff","$30.00","$0.00","Cleared"
"Checking","","11/03/2026","Transfer : Visa","","","","","$200.00","$0.00","Cleared"
"Visa","","11/03/2026","Transfer : Checking","","","","","$0.00","$200.00","Cleared"
"Checking","","11/02/2026","Transfer : Roth IRA","Savings: Roth IRA","Savings","Roth IRA","","$500.00","$0.00","Cleared"
"Roth IRA","","11/02/2026","Transfer : Checking","","","","","$0.00","$500.00","Cleared"
"Visa","","11/01/2026","Kroger","Everyday: Groceries","Everyday","Groceries","","$120.00","$0.00","Uncleared"
"Checking","","11/01/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","Nov pay","$0.00","$4,000.00","Reconciled"
"Checking","","10/15/2026","Kroger","Everyday: Groceries","Everyday","Groceries","","$400.00","$0.00","Reconciled"
"Checking","","10/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","$0.00","$3,000.00","Reconciled"
"Visa","","10/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","$300.00","$0.00","Reconciled"
"Roth IRA","","10/01/2026","Starting Balance","","","","","$0.00","$10,000.00","Reconciled"
`;
const PLAN = `"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"
"Oct 2026","Everyday: Groceries","Everyday","Groceries","$600.00","-$400.00","$200.00"
"Oct 2026","Savings: Roth IRA","Savings","Roth IRA","$500.00","$0.00","$500.00"
"Oct 2026","Credit Card Payments: Visa","Credit Card Payments","Visa","$0.00","$0.00","-$300.00"
"Nov 2026","Everyday: Groceries","Everyday","Groceries","$650.00","-$190.00","$660.00"
"Nov 2026","Everyday: Household","Everyday","Household","$50.00","-$30.00","$20.00"
"Nov 2026","Savings: Roth IRA","Savings","Roth IRA","$500.00","-$500.00","$500.00"
"Nov 2026","Credit Card Payments: Visa","Credit Card Payments","Visa","$100.00","$120.00","$-80.00"
`.replace("Split (2/2) stuff", "Split (2/2) stuff");

// the second split line is Household (YNAB puts each line's category on its row)
const REG = REGISTER.replace(`"Split (1/2) food","$70.00"`, `"Split (1/2) food","$70.00"`)
  .replace(`"Checking","","11/05/2026","Target","","","","Split (1/2) food"`, `"Checking","","11/05/2026","Target","Everyday: Groceries","Everyday","Groceries","Split (1/2) food"`)
  .replace(`"Checking","","11/05/2026","Target","","","","Split (2/2) stuff"`, `"Checking","","11/05/2026","Target","Everyday: Household","Everyday","Household","Split (2/2) stuff"`);

describe("reading YNAB's files", () => {
  it("parses CSV, amounts, dates and months the way YNAB writes them", () => {
    expect(parseCsv(`a,"b, c","d ""e"""\r\n1,2,3`)).toEqual([["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
    expect(money("$1,234.56")).toBe(1234.56);
    expect(money("-$12.30")).toBe(-12.3);
    expect(money("(5.00)")).toBe(-5);
    expect(money("1.234,56 €")).toBe(1234.56);
    expect(dateParser(["11/05/2026", "10/01/2026"])("11/05/2026")).toBe("2026-11-05");
    expect(dateParser(["25/12/2026", "01/11/2026"])("01/11/2026")).toBe("2026-11-01"); // day first
    expect(dateParser(["2026-11-05"])("2026-11-05")).toBe("2026-11-05");
    expect(monthOf("Nov 2026")).toBe("2026-11");
    expect(monthOf("November 2026")).toBe("2026-11");
    expect(monthOf("11/2026")).toBe("2026-11");
  });

  it("puts split lines back together and finds transfers", () => {
    const d = parseYnab(REG, PLAN);
    const split = d.txns.find((t) => t.payee === "Target")!;
    expect(split.amount).toBe(-100);
    expect(split.splits).toEqual([
      { group: "Everyday", category: "Groceries", amount: -70, memo: "food" },
      { group: "Everyday", category: "Household", amount: -30, memo: "stuff" },
    ]);
    expect(d.txns.filter((t) => t.transferTo).map((t) => `${t.account}→${t.transferTo}`)).toEqual(["Checking→Visa", "Visa→Checking", "Checking→Roth IRA", "Roth IRA→Checking"]);
    expect(d.assigned).toHaveLength(7);
  });

  it("works out each account's kind and balance, and suggests matches", () => {
    const d = parseYnab(REG, PLAN);
    const accts = ynabAccounts(d);
    expect(accts.map((a) => [a.name, a.kind, a.balance])).toEqual([
      ["Checking", "cash", 5800], // 3,000 − 400 + 4,000 − 500 − 200 − 100
      ["Roth IRA", "invest", 10500],
      ["Visa", "card", -220], // owes 300 + 120 − 200
    ]);
    const plan = freshPlan();
    plan.accounts = [{ id: "chk", name: "checking", type: "cash", balance: 1 }];
    expect(suggestChoice(plan, accts[0]!)).toEqual({ action: "match", id: "chk" });
    expect(suggestChoice(plan, accts[2]!)).toEqual({ action: "add" });
    // only the same name: "Old Bank Checking" isn't your Checking, and each account here is matched once
    expect(suggestChoice(plan, { ...accts[0]!, name: "Old Bank Checking" })).toEqual({ action: "add" });
    expect(suggestChoice(plan, accts[0]!, new Set(["chk"]))).toEqual({ action: "add" });
    expect(ynabCategories(d, ["2026-10", "2026-11"]).map((c) => [c.name, c.average])).toEqual([["Groceries", 625], ["Roth IRA", 500], ["Household", 25]]);
  });
});

describe("importing into the plan", () => {
  const setup = () => {
    const plan: PlanState = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1 }];
    plan.budget = [
      { id: "food", name: "Groceries", amount: 0, inRetirement: true, group: "Food" },
      { id: "util", name: "Utilities", amount: 0, inRetirement: true, group: "Housing" },
    ];
    let n = 0;
    const d = parseYnab(REG, PLAN);
    const opts = {
      from: "2026-11", thisMonth: "2026-12", accounts: {}, removeEmpty: true, newId: () => `n${++n}`,
      categories: { [categoryKey("Everyday", "Household")]: { inRetirement: false, essential: false } },
    };
    return { plan, d, opts };
  };

  it("brings in accounts, categories, assignments and transactions for the months you pick", () => {
    const { plan, d, opts } = setup();
    const r = buildImport(plan, d, opts);
    // Checking matched; Visa (a card) and the Roth IRA added
    expect(r.plan.accounts.map((a) => [a.name, a.type, a.balance])).toEqual([["Checking", "cash", 1], ["Roth IRA", "taxable", 10500]]);
    expect(r.plan.debts.map((x) => [x.name, x.kind, x.balance])).toEqual([["Visa", "credit_card", 220]]);
    // Groceries matched (now YNAB's group and amount), Utilities ($0, not in YNAB) removed, two added
    expect(r.plan.budget.map((b) => [b.name, b.group, b.amount])).toEqual([["Groceries", "Everyday", 625], ["Roth IRA", "Savings", 500], ["Household", "Everyday", 25]]);
    expect(r.plan.budget.find((b) => b.name === "Household")).toMatchObject({ inRetirement: false, essential: false });
    expect(r.summary).toMatchObject({ accountsAdded: 2, categoriesAdded: 2, categoriesUpdated: 1, categoriesRemoved: 1 });
    // November's assignments, including the card payment
    const visa = r.plan.debts[0]!.id;
    expect(r.plan.budgetPlan!.months["2026-11"]!.assigned).toEqual({ food: 650, [r.plan.budget[2]!.id]: 50, [r.plan.budget[1]!.id]: 500, ["debt:" + visa]: 100 });
    expect(r.plan.budgetPlan!.start).toBe("2026-11");
    // each budget account starts with its balance on Nov 1; October's transactions aren't brought in
    const start = r.txns.filter((t) => t.id.startsWith("start:"));
    expect(start.map((t) => [t.accountId, t.amount, t.categoryId]).sort()).toEqual([["chk", 2600, "ready"], [visa, -300, undefined]]);
    expect(r.txns.some((t) => t.date < "2026-11-01" && !t.id.startsWith("start:"))).toBe(false);
    // the balances the transactions add up to are YNAB's
    expect(registerBalance(0, r.txns, "chk")).toBe(5800);
    expect(registerBalance(0, r.txns, visa)).toBe(-220);
  });

  it("transfers pair up, the IRA transfer keeps its category, splits keep theirs, and the budget adds up", () => {
    const { plan, d, opts } = setup();
    const r = buildImport(plan, d, opts);
    const visa = r.plan.debts[0]!.id;
    const pay = r.txns.filter((t) => t.transferAccountId && (t.accountId === visa || t.transferAccountId === visa));
    expect(pay).toHaveLength(2);
    expect(pay[0]!.transferId).toBe(pay[1]!.id);
    expect(pay.every((t) => !t.categoryId)).toBe(true);
    const ira = r.txns.find((t) => t.amount === -500)!;
    expect(ira.categoryId).toBe(r.plan.budget[1]!.id);
    const target = r.txns.find((t) => t.payee === "Target")!;
    expect(target.splits!.map((s) => [s.categoryId, s.amount])).toEqual([["food", -70], [r.plan.budget[2]!.id, -30]]);
    // the November budget: groceries got 650, spent 120 on the Visa + 70 at Target
    const cats = r.plan.budget.map((b) => ({ key: b.id, moves: false, target: b.amount })).concat([{ key: "debt:" + visa, moves: true, target: 0 }]);
    const v = budgetView({ ...r.plan.budgetPlan!, startCash: 0 }, cats, "2026-11", { txns: r.txns, cards: cardMap(r.plan) });
    expect(v.lines.food!.spent).toBeCloseTo(190, 6);
    expect(v.lines.food!.available).toBeCloseTo(460, 6);
    expect(v.income).toBeCloseTo(4000 + 2600, 6); // pay + checking's starting balance
  });

  it("bringing in everything starts each account with YNAB's own Starting Balance", () => {
    const { plan, d, opts } = setup();
    const r = buildImport(plan, d, { ...opts, from: null });
    const starts = r.txns.filter((x) => x.id.startsWith("start:"));
    expect(starts.map((x) => [x.accountId === "chk" ? "chk" : "visa", x.amount, x.date]).sort()).toEqual([["chk", 3000, "2026-10-01"], ["visa", -300, "2026-10-01"]]);
    expect(r.txns.filter((x) => /starting balance/i.test(x.payee ?? ""))).toHaveLength(2);
    expect(registerBalance(0, r.txns, "chk")).toBe(5800);
    expect(r.plan.budgetPlan!.months["2026-10"]!.assigned!.food).toBe(600);
  });

  it("two YNAB accounts never land in one account here", () => {
    const { plan, d, opts } = setup();
    const r = buildImport(plan, d, { ...opts, accounts: { Checking: { action: "match", id: "chk" }, "Roth IRA": { action: "match", id: "chk" } } });
    expect(r.plan.accounts.map((a) => a.name)).toEqual(["Checking", "Roth IRA"]); // the IRA was added, not merged
    expect(r.txns.filter((x) => x.accountId === "chk").every((x) => x.id.startsWith("start:") || x.payee !== "Starting Balance")).toBe(true);
  });

  it("importing again replaces what came in before (same ids), and skipped accounts stay out", () => {
    const { plan, d, opts } = setup();
    const a = buildImport(plan, d, opts);
    const b = buildImport(a.plan, d, { ...opts, accounts: { "Roth IRA": { action: "skip" } } });
    expect(b.txns.map((t) => t.id)).toEqual(a.txns.map((t) => t.id));
    expect(b.plan.budget.map((x) => x.name)).toEqual(a.plan.budget.map((x) => x.name));
    const c = buildImport(plan, d, { ...opts, accounts: { Visa: { action: "skip" } } });
    expect(c.plan.debts).toHaveLength(0);
    expect(c.txns.some((t) => t.accountId !== "chk")).toBe(false);
  });
});

describe("choosing where categories go, and matching your own transactions", () => {
  const base = () => {
    const plan: PlanState = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1 }];
    plan.budget = [
      { id: "food", name: "Food", amount: 0, inRetirement: true, group: "Food" },
      { id: "home", name: "Home stuff", amount: 0, inRetirement: true, group: "Home" },
    ];
    let n = 0;
    return { plan, d: parseYnab(REG, PLAN), opts: { from: "2026-11", thisMonth: "2026-12", accounts: {}, categories: {}, removeEmpty: false, newId: () => `n${++n}` } };
  };

  it("a YNAB category can go into one of yours, the Emergency fund, or be left out", () => {
    const { plan, d, opts } = base();
    const r = buildImport(plan, d, {
      ...opts,
      categoryMap: {
        [categoryKey("Everyday", "Groceries")]: { action: "match", id: "food" },
        [categoryKey("Everyday", "Household")]: { action: "match", id: "home" },
        [categoryKey("Savings", "Roth IRA")]: { action: "match", id: "cash" },
      },
    });
    expect(r.plan.budget.map((b) => b.id)).toEqual(["food", "home"]); // nothing new
    expect(r.plan.budgetPlan!.months["2026-11"]!.assigned).toMatchObject({ food: 650, home: 50, cash: 500 });
    expect(r.txns.find((t) => t.payee === "Target")!.splits!.map((s) => s.categoryId)).toEqual(["food", "home"]);
    const skip = buildImport(plan, d, { ...opts, categoryMap: { [categoryKey("Everyday", "Household")]: { action: "skip" } } });
    expect(skip.summary.categoriesSkipped).toBe(1);
    expect(skip.plan.budget.some((b) => b.name === "Household")).toBe(false);
    // its line has nowhere to go, but stays (needing a category) so the split still adds up
    expect(skip.txns.find((t) => t.payee === "Target")!.splits!.map((s) => [s.categoryId, s.amount])).toEqual([[expect.stringMatching(/./), -70], ["", -30]]);
    expect(skip.summary.needsCategoryLeftOut).toBe(1);
    expect(skip.summary.needsCategoryFromYnab).toBe(0);
  });

  it("two of YNAB's categories into one of yours add up", () => {
    const { plan, d, opts } = base();
    const r = buildImport(plan, d, { ...opts, categoryMap: { [categoryKey("Everyday", "Groceries")]: { action: "match", id: "food" }, [categoryKey("Everyday", "Household")]: { action: "match", id: "food" } } });
    expect(r.plan.budgetPlan!.months["2026-11"]!.assigned!.food).toBe(700);
  });

  it("your own transactions that YNAB also has give way to YNAB's", () => {
    const { plan, d, opts } = base();
    const mine = (id: string, date: string, amount: number) => ({ id, accountId: "chk", date, amount, categoryId: "food", cleared: "cleared" as const, source: "manual" as const, updatedAt: 1 });
    const existing = [mine("m1", "2026-11-03", -100), mine("m2", "2026-11-20", -100), mine("m3", "2026-11-01", 4000)];
    const r = buildImport(plan, d, { ...opts, existing });
    expect(r.replaced.sort()).toEqual(["m1", "m3"]); // Target (Nov 5) and the paycheck; Nov 20 is too far off
    expect(r.summary.transactionsMatched).toBe(2);
    expect(buildImport(plan, d, { ...opts, existing, replaceMatching: false }).replaced).toEqual([]);
    // each match is shown to confirm; one you say isn't the same stays alongside YNAB's
    expect(r.matches.map((m) => [m.mine.id, m.ynab.payee])).toEqual([["m1", "Target"], ["m3", "Employer"]]);
    expect(buildImport(plan, d, { ...opts, existing, keepBoth: ["m1"] }).replaced).toEqual(["m3"]);
  });
});
