import { budgetStartCash, budgetView, registerBalance, type PlanState } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { freshPlan } from "./presets";
import { cardMap } from "./register";
import { balanceConflicts, buildImport, categoryKey, groupKey, exportMonths, dateParser, money, monthOf, nameId, notCounted, budgetTxnsThisMonth, parseCsv, parseYnab, suggestChoice, ynabAccounts, ynabCategories, ynabReadyToAssign } from "./ynab";

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
`;

// the second split line is Household (YNAB puts each line's category on its row)
const REG = REGISTER.replace(`"Checking","","11/05/2026","Target","","","","Split (1/2) food"`, `"Checking","","11/05/2026","Target","Everyday: Groceries","Everyday","Groceries","Split (1/2) food"`)
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

  it("uses the amount a month you set in place of YNAB's average", () => {
    const { plan, d, opts } = setup();
    const r = buildImport(plan, d, { ...opts, amounts: { [categoryKey("Everyday", "Groceries")]: 725 } });
    expect(r.plan.budget.find((b) => b.name === "Groceries")?.amount).toBe(725);
  });

  it("drops setup's empty Savings / checking once YNAB brings in a checking account, keeping ones in use", () => {
    const { d, opts } = setup();
    const plan = freshPlan();
    const empty = plan.accounts.find((a) => a.type === "cash")!;
    plan.accounts.push({ id: "used", name: "Cash jar", type: "cash", balance: 0 });
    const r = buildImport(plan, d, { ...opts, existing: [{ id: "t1", accountId: "used", date: "2026-11-02", amount: -5 } as never] });
    expect(r.plan.accounts.some((a) => a.id === empty.id)).toBe(false);
    expect(r.plan.accounts.some((a) => a.id === "used")).toBe(true);
    expect(r.plan.accounts.some((a) => a.name === "401(k)")).toBe(true);
    expect(r.summary.accountsRemoved).toBe(1);
    // nothing of YNAB's checking comes in: it stays
    const kept = buildImport(plan, d, { ...opts, accounts: Object.fromEntries(ynabAccounts(d).map((a) => [a.name, { action: "skip" as const }])) });
    expect(kept.plan.accounts.some((a) => a.id === empty.id)).toBe(true);
  });

  it("lists the export's months, newest first", () => {
    const { d } = setup();
    const m = exportMonths(d, "2026-11");
    expect(m[0]).toBe("2026-11");
    expect([...m].sort().reverse()).toEqual(m);
  });

  it("puts one category into its own group, apart from the rest of its YNAB group", () => {
    const { plan, d, opts } = setup();
    const r = buildImport(plan, d, { ...opts, groupMap: { [groupKey("Everyday")]: "Living" }, categoryGroup: { [categoryKey("Everyday", "Household")]: "Home" } });
    expect(r.plan.budget.find((b) => b.name === "Groceries")?.group).toBe("Living");
    expect(r.plan.budget.find((b) => b.name === "Household")?.group).toBe("Home");
  });

  it("puts a YNAB group's categories into the group you pick", () => {
    const { plan, d, opts } = setup();
    const r = buildImport(plan, d, { ...opts, groupMap: { [groupKey("Everyday")]: "Living" } });
    expect(r.plan.budget.filter((b) => b.name === "Groceries" || b.name === "Household").map((b) => b.group)).toEqual(["Living", "Living"]);
    expect(r.plan.budget.find((b) => b.name === "Roth IRA")?.group).toBe("Savings"); // other groups keep their name
  });

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
    // the budget starts this month (December), with what each category had left in YNAB at the end of
    // November (Groceries $660, Household $20, the Roth IRA $500; the card's payment line was short, so nothing)
    const visa = r.plan.debts[0]!.id;
    expect(r.plan.budgetPlan!.start).toBe("2026-12");
    expect(r.plan.budgetPlan!.opening).toEqual({ food: 660, [r.plan.budget[2]!.id]: 20, [r.plan.budget[1]!.id]: 500 });
    expect(r.plan.budgetPlan!.months["2026-11"]).toBeUndefined();
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
    // the December budget: groceries start with the $660 YNAB had left at the end of November
    const cats = r.plan.budget.map((b) => ({ key: b.id, moves: false, target: b.amount })).concat([{ key: "debt:" + visa, moves: true, target: 0 }]);
    const v = budgetView({ ...r.plan.budgetPlan!, startCash: 0 }, cats, "2026-12", { txns: r.txns, cards: cardMap(r.plan) });
    expect(v.lines.food!.carried).toBeCloseTo(660, 6);
    expect(v.lines.food!.available).toBeCloseTo(660, 6);
  });

  it("an investment account or loan matched to yours keeps your balance unless you pick YNAB's", () => {
    const { plan, d, opts } = setup();
    plan.accounts.push({ id: "ira", name: "Roth IRA", type: "roth", balance: 9000 });
    const accounts = { Checking: { action: "match" as const, id: "chk" }, "Roth IRA": { action: "match" as const, id: "ira" } };
    expect(balanceConflicts(plan, ynabAccounts(d), accounts)).toEqual([{ name: "Roth IRA", yours: 9000, ynab: 10500, owed: false }]);
    expect(buildImport(plan, d, { ...opts, accounts }).plan.accounts.find((a) => a.id === "ira")!.balance).toBe(9000);
    expect(buildImport(plan, d, { ...opts, accounts, useYnabBalance: { "Roth IRA": true } }).plan.accounts.find((a) => a.id === "ira")!.balance).toBe(10500);
  });

  it("bringing in everything starts each account with YNAB's own Starting Balance", () => {
    const { plan, d, opts } = setup();
    const r = buildImport(plan, d, { ...opts, from: null });
    const starts = r.txns.filter((x) => x.id.startsWith("start:"));
    expect(starts.map((x) => [x.accountId === "chk" ? "chk" : "visa", x.amount, x.date]).sort()).toEqual([["chk", 3000, "2026-10-01"], ["visa", -300, "2026-10-01"]]);
    expect(r.txns.filter((x) => /starting balance/i.test(x.payee ?? ""))).toHaveLength(2);
    expect(registerBalance(0, r.txns, "chk")).toBe(5800);
    // every transaction comes in, but the budget starts this month (older months are history), with
    // Groceries' $660 left from November and checking's $5,800 on Dec 1 as its starting money
    expect(r.plan.budgetPlan!.start).toBe("2026-12");
    expect(r.plan.budgetPlan!.months["2026-10"]).toBeUndefined();
    expect(r.plan.budgetPlan!.opening!.food).toBe(660);
    expect(budgetStartCash(r.plan, r.txns, "2026-12")).toBe(5800);
  });

  it("an account added gets the company and name you give it (matched ones keep yours)", () => {
    const { plan, d, opts } = setup();
    const r = buildImport(plan, d, { ...opts, names: { Visa: { company: "Chase", name: "Sapphire" }, Checking: { company: "Ally", name: "Main" } } });
    expect(r.plan.debts.find((x) => x.company === "Chase")).toMatchObject({ name: "Sapphire", kind: "credit_card" });
    // Checking was matched to yours: its name stays
    expect(r.plan.accounts.find((a) => a.id === "chk")).toMatchObject({ name: "Checking" });
    expect(r.plan.accounts.find((a) => a.id === "chk")!.company).toBeUndefined();
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
    expect(r.plan.budgetPlan!.opening).toMatchObject({ food: 660, home: 20, cash: 500 }); // what each had left in November
    expect(r.txns.find((t) => t.payee === "Target")!.splits!.map((s) => s.categoryId)).toEqual(["food", "home"]);
    const skip = buildImport(plan, d, { ...opts, categoryMap: { [categoryKey("Everyday", "Household")]: { action: "skip" } } });
    expect(skip.summary.categoriesSkipped).toBe(1);
    expect(skip.plan.budget.some((b) => b.name === "Household")).toBe(false);
    // its line has nowhere to go, but stays (needing a category) so the split still adds up
    expect(skip.txns.find((t) => t.payee === "Target")!.splits!.map((s) => [s.categoryId, s.amount])).toEqual([[expect.stringMatching(/./), -70], ["", -30]]);
    expect(skip.summary.needsCategoryLeftOut).toBe(1);
    expect(skip.summary.needsCategoryFromYnab).toBe(0);
    // the left-out category is kept (hidden) on that line, for sorting old spending later; the other line doesn't need it
    expect(skip.txns.find((t) => t.payee === "Target")!.splits!.map((s) => s.originalCategory)).toEqual([undefined, "Everyday: Household"]);
  });

  it("a category kept as hidden takes its transactions, off the budget and plan", () => {
    const { plan, d, opts } = base();
    const r = buildImport(plan, d, { ...opts, categoryMap: { [categoryKey("Everyday", "Household")]: { action: "hidden" } } });
    expect(r.summary.categoriesHidden).toBe(1);
    const hh = r.plan.budget.find((b) => b.name === "Household")!;
    expect(hh).toMatchObject({ hidden: true, amount: 0, group: "Everyday" });
    expect(r.plan.budget.at(-1)!.id).toBe(hh.id); // hidden ones go last
    const line = r.txns.find((t) => t.payee === "Target")!.splits![1]!;
    expect(line.categoryId).toBe(hh.id);
    expect(line.originalCategory).toBeUndefined();
    expect(r.summary.needsCategoryLeftOut).toBe(0);
    // importing again: it goes into the same hidden category, which stays hidden with no amount
    const again = buildImport(r.plan, d, { ...opts, existing: r.txns });
    expect(again.plan.budget.filter((b) => b.name === "Household")).toEqual([hh]);
  });

  it("a transfer to an account you left out stays a transfer, needing no category", () => {
    const { plan, d, opts } = base();
    const r = buildImport(plan, d, { ...opts, accounts: { Visa: { action: "skip" } } });
    const pay = r.txns.find((t) => t.transferAccountId === "outside:Visa")!;
    expect(pay.amount).toBe(-200);
    expect(pay.categoryId).toBeUndefined();
    expect(r.summary.transfersOutside).toBe(1);
    expect(r.summary.needsCategoryFromYnab).toBe(0);
  });

  it("only this month's and last month's transactions are asked for a category", () => {
    const { plan, d, opts } = base();
    // the left-out Household line is from November: recent in December, history by February
    const skip = { categoryMap: { [categoryKey("Everyday", "Household")]: { action: "skip" as const } } };
    const dec = buildImport(plan, d, { ...opts, ...skip });
    expect(dec.summary.needsCategoryLeftOut).toBe(1);
    expect(dec.summary.olderWithoutCategory).toBe(0);
    const feb = buildImport(plan, d, { ...opts, ...skip, thisMonth: "2027-02" });
    expect(feb.summary.needsCategoryLeftOut).toBe(0);
    expect(feb.summary.olderWithoutCategory).toBe(1);
  });

  it("two of YNAB's categories into one of yours add up", () => {
    const { plan, d, opts } = base();
    const r = buildImport(plan, d, { ...opts, categoryMap: { [categoryKey("Everyday", "Groceries")]: { action: "match", id: "food" }, [categoryKey("Everyday", "Household")]: { action: "match", id: "food" } } });
    expect(r.plan.budgetPlan!.opening!.food).toBe(680); // the $660 and $20 they had left in November
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

describe("the same ids on every device", () => {
  it("two imports of the same export (on two devices) add accounts and categories with the same ids", () => {
    const plan: PlanState = freshPlan();
    const d = parseYnab(REG, PLAN);
    const opts = { from: "2026-11", thisMonth: "2026-12", accounts: {}, categories: {}, removeEmpty: false };
    const a = buildImport(structuredClone(plan), d, opts);
    const b = buildImport(structuredClone(plan), d, opts);
    const ids = (r: typeof a) => [...r.plan.accounts, ...r.plan.debts, ...r.plan.budget].map((x) => x.id);
    expect(ids(a)).toEqual(ids(b));
    expect(a.txns.map((t) => [t.id, t.accountId, t.categoryId])).toEqual(b.txns.map((t) => [t.id, t.accountId, t.categoryId]));
    // every transaction points at an account and category the plan has
    const accts = new Set([...a.plan.accounts, ...a.plan.debts].map((x) => x.id));
    const cats = new Set(a.plan.budget.map((x) => x.id));
    expect(a.txns.every((t) => accts.has(t.accountId))).toBe(true);
    expect(a.txns.every((t) => !t.categoryId || t.categoryId === "ready" || t.categoryId === "cash" || t.categoryId.startsWith("debt:") || cats.has(t.categoryId))).toBe(true);
  });

  it("never reuses an id the plan already has", () => {
    const used = new Set<string>();
    const first = nameId("acct", "Checking", used);
    expect(nameId("acct", "checking ", used)).not.toBe(first);
    expect(nameId("cat", "Checking", new Set())).not.toBe(first);
  });
});

describe("balances as YNAB shows them", () => {
  it("today's balance leaves out transactions dated later; they're listed as upcoming", () => {
    const t = (date: string, amount: number) => ({ account: "Travel", date, amount, payee: "", memo: "", group: "Fun", category: "Trips", cleared: "cleared" as const });
    const d = { txns: [t("2026-11-01", 1050.01), t("2026-11-27", 2429.16)], assigned: [] } as unknown as Parameters<typeof ynabAccounts>[0];
    const [a] = ynabAccounts(d, "2026-11-17");
    expect(a!.balance).toBe(1050.01);
    expect(a!.upcoming).toBe(2429.16);
    // no date given: everything counts (as before)
    expect(ynabAccounts(d)[0]!.balance).toBe(3479.17);
  });
});

describe("YNAB's budget replaces the months it brings in", () => {
  it("an amount on a line YNAB doesn't have is gone from those months, and later months are left alone", () => {
    const plan: PlanState = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1 }];
    plan.debts = [{ id: "house", name: "Mortgage", kind: "mortgage", balance: 300000, apr: 0.06, minPayment: 2000 }];
    // budgeted here before the import: the mortgage payment line (YNAB pays it from its own category)
    plan.budgetPlan = { start: "2026-11", startCash: 0, months: { "2026-11": { assigned: { "debt:house": 2000 } }, "2027-01": { assigned: { "debt:house": 2000 } } } };
    let n = 0;
    const r = buildImport(plan, parseYnab(REG, PLAN), { from: "2026-11", thisMonth: "2026-11", accounts: {}, categories: {}, removeEmpty: false, newId: () => `n${++n}` });
    const months = r.plan.budgetPlan!.months;
    expect(months["2026-11"]?.assigned?.["debt:house"]).toBeUndefined();
    expect(Object.values(months["2026-11"]?.assigned ?? {}).length).toBeGreaterThan(0);
    expect(months["2027-01"]?.assigned?.["debt:house"]).toBe(2000);
  });
});

describe("money moved out of a category in YNAB", () => {
  it("a negative amount comes in as it is: money taken back out of the category", () => {
    // October left $500 in Roth IRA; in November it was moved back out (a negative amount in YNAB)
    const plan = PLAN.replace(`"Nov 2026","Savings: Roth IRA","Savings","Roth IRA","$500.00","-$500.00","$500.00"`, `"Nov 2026","Savings: Roth IRA","Savings","Roth IRA","-$500.00","$0.00","$0.00"`);
    expect(plan).not.toBe(PLAN);
    const p: PlanState = freshPlan();
    p.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1 }];
    let n = 0;
    const r = buildImport(p, parseYnab(REG, plan), { from: "2026-11", thisMonth: "2026-11", accounts: {}, categories: {}, removeEmpty: false, newId: () => `n${++n}` });
    const roth = r.plan.budget.find((b) => b.name === "Roth IRA")!;
    const groceries = r.plan.budget.find((b) => b.name === "Groceries")!;
    const nov = r.plan.budgetPlan!.months["2026-11"]!.assigned!;
    expect(nov[roth.id]).toBe(-500);
    expect(r.plan.budgetPlan!.opening![roth.id]).toBe(500);
    // Groceries: November's $650, starting with October's $200 left over
    expect(nov[groceries.id]).toBe(650);
    expect(r.plan.budgetPlan!.opening![groceries.id]).toBe(200);
    const cats = r.plan.budget.map((b) => ({ key: b.id, moves: false, target: 0 }));
    const v = budgetView(r.plan.budgetPlan!, cats, "2026-11", { txns: r.txns, cards: cardMap(r.plan) });
    // all $500 it had comes back out (to Unassigned)
    expect(v.lines[roth.id]!.carried).toBe(500);
    expect(v.lines[roth.id]!.assigned).toBe(-500);
  });
});

describe("YNAB's card overspending comes in as card debt", () => {
  // November: Groceries went $40 over in YNAB ($150 to spend, then $120 on the Visa and $70 from Checking)
  const plan = PLAN.replace(`"Nov 2026","Everyday: Groceries","Everyday","Groceries","$650.00","-$190.00","$660.00"`, `"Nov 2026","Everyday: Groceries","Everyday","Groceries","$650.00","-$190.00","-$40.00"`);
  it("the purchase that took a category past $0 holds the overspending: on a card it's left as debt (not taken from Unassigned)", () => {
    expect(plan).not.toBe(PLAN);
    // the Visa purchase came last (Nov 6), so it's the one that went over
    const reg = REG.replace(`"Visa","","11/01/2026","Kroger"`, `"Visa","","11/06/2026","Kroger"`);
    expect(reg).not.toBe(REG);
    const p: PlanState = freshPlan();
    p.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1 }];
    let n = 0;
    const r = buildImport(p, parseYnab(reg, plan), { from: "2026-11", thisMonth: "2026-11", today: "2026-11-30", accounts: {}, categories: {}, removeEmpty: false, newId: () => `n${++n}` });
    const groceries = r.plan.budget.find((b) => b.name === "Groceries")!;
    const visa = r.plan.debts.find((d) => d.name === "Visa")!;
    expect(r.plan.budgetPlan!.months["2026-11"]!.cardDebt).toEqual([{ cat: groceries.id, card: "debt:" + visa.id, amount: 40 }]);
  });
  it("overspending from a cash purchase isn't card debt, even with card purchases earlier in the month", () => {
    // the Visa purchase (Nov 1) came first and was covered; Checking's (Nov 5) went over
    const p: PlanState = freshPlan();
    p.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1 }];
    let n = 0;
    const r = buildImport(p, parseYnab(REG, plan), { from: "2026-11", thisMonth: "2026-11", today: "2026-11-30", accounts: {}, categories: {}, removeEmpty: false, newId: () => `n${++n}` });
    expect(r.plan.budgetPlan!.months["2026-11"]?.cardDebt).toBeUndefined();
  });
});

describe("transactions YNAB doesn't count yet (not approved there)", () => {
  // YNAB's November Groceries leaves out the $120 Kroger purchase (uncleared): $70 spent, not $190
  const plan = PLAN.replace(`"Nov 2026","Everyday: Groceries","Everyday","Groceries","$650.00","-$190.00","$660.00"`, `"Nov 2026","Everyday: Groceries","Everyday","Groceries","$650.00","-$70.00","$780.00"`);
  it("are found: the newest uncleared ones of the category that make up the difference", () => {
    expect(plan).not.toBe(PLAN);
    const d = parseYnab(REG, plan);
    expect(notCounted(d, "2026-10", "2026-11").map((t) => t.payee)).toEqual(["Kroger"]);
    // nothing to find when YNAB counts everything
    expect(notCounted(parseYnab(REG, PLAN), "2026-10", "2026-11")).toEqual([]);
  });
  it("come in with no category, to categorize here, keeping YNAB's as a note", () => {
    const p: PlanState = freshPlan();
    p.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1 }];
    let n = 0;
    const r = buildImport(p, parseYnab(REG, plan), { from: "2026-11", thisMonth: "2026-11", today: "2026-11-30", accounts: {}, categories: {}, removeEmpty: false, newId: () => `n${++n}` });
    const kroger = r.txns.find((t) => t.payee === "Kroger")!;
    expect(kroger.categoryId).toBeUndefined();
    expect(kroger.originalCategory).toBe("Everyday: Groceries");
    expect(r.summary.notApprovedInYnab).toBe(1);
  });
});

describe("an account left out that the budget uses this month", () => {
  it("counts its transactions filed under a category or Ready to Assign, not transfers", () => {
    const d = parseYnab(REG, PLAN);
    // Checking in November: the split at Target and the pay (the IRA transfer and the card payment are transfers)
    expect(budgetTxnsThisMonth(d, "Checking", "2026-11")).toBe(2);
    expect(budgetTxnsThisMonth(d, "Visa", "2026-11")).toBe(1);
    // through today only, and nothing in a month it wasn't used
    expect(budgetTxnsThisMonth(d, "Visa", "2026-11", "2026-10-31")).toBe(0);
    expect(budgetTxnsThisMonth(d, "Roth IRA", "2026-11")).toBe(0);
  });
});

describe("YNAB's Ready to Assign", () => {
  it("is the cash in budget accounts, less what's left in categories and later months", () => {
    // Checking has $5,800; $660 + $20 + $500 is left in categories (the Visa's payment line is short, so nothing)
    const d = parseYnab(REG, PLAN);
    expect(ynabReadyToAssign(d, "2026-11", "2026-11-30")).toBe(4620);
    // only accounts you brought in count
    expect(ynabReadyToAssign(d, "2026-11", "2026-11-30", (a) => a !== "Checking")).toBe(-1180);
    // without the Plan file there's nothing to go by
    expect(ynabReadyToAssign(parseYnab(REG), "2026-11", "2026-11-30")).toBeNull();
  });
});

describe("categories you hid in YNAB", () => {
  it("come in as hidden categories, keeping what was assigned and spent (YNAB still counts them)", () => {
    const reg = REG.replace(`"Checking","","11/01/2026","Employer"`, `"Checking","","11/02/2026","Language school","Hidden Categories: Tutoring","Hidden Categories","Tutoring","","$100.00","$0.00","Cleared"\n"Checking","","11/01/2026","Employer"`);
    const plan = PLAN + `"Nov 2026","Hidden Categories: Tutoring","Hidden Categories","Tutoring","$100.00","-$100.00","$0.00"\n`;
    const p: PlanState = freshPlan();
    p.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1 }];
    let n = 0;
    const d = parseYnab(reg, plan);
    expect(ynabCategories(d, ["2026-10", "2026-11"]).some((c) => c.name === "Tutoring")).toBe(true);
    const r = buildImport(p, d, { from: "2026-11", thisMonth: "2026-11", accounts: {}, categories: {}, removeEmpty: false, newId: () => `n${++n}` });
    const tutoring = r.plan.budget.find((b) => b.name === "Tutoring")!;
    expect(tutoring.hidden).toBe(true);
    expect(r.plan.budgetPlan!.months["2026-11"]!.assigned![tutoring.id]).toBe(100);
    expect(r.txns.find((t) => t.payee === "Language school")!.categoryId).toBe(tutoring.id);
  });
});
