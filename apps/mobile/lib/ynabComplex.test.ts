import { budgetView, registerBalance, type PlanState } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { freshPlan } from "./presets";
import { applyRegisterBalances, cardMap, liveBudget } from "./register";
import { PLAN, REGISTER, TODAY, YNAB_SAYS } from "./testdata/ynabComplex";
import { buildImport, categoryKey, parseYnab, suggestCategory, suggestChoice, ynabAccounts, ynabCategories, ynabReadyToAssign, type AccountChoice, type CategoryChoice } from "./ynab";

/**
 * The made-up export with the hard cases (testdata/ynabComplex.ts), imported the way the import screen
 * does it by default: everything Coastwise shows for November matches what YNAB shows.
 */
describe("a complex YNAB export comes in matching YNAB", () => {
  const before = (): PlanState => {
    const p = freshPlan();
    // yours before the import: the same accounts, named your way
    p.accounts = [
      { id: "mine-chk", name: "Checking Account", type: "cash", balance: 6391 },
      { id: "mine-sav", name: "Bank - Savings", type: "cash", balance: 2500 },
    ];
    return p;
  };
  const d = parseYnab(REGISTER, PLAN);
  const run = () => {
    const plan = before();
    // the import screen's defaults: matched by name or balance, quiet accounts left out, YNAB's hidden ones hidden
    const taken = new Set<string>();
    const accounts: Record<string, AccountChoice> = {};
    for (const a of ynabAccounts(d, TODAY)) {
      const quiet = Math.abs(a.balance) < 0.005 && !d.txns.some((t) => t.account === a.name && t.date >= "2026-10-01");
      const c: AccountChoice = quiet ? { action: "skip" } : suggestChoice(plan, a, taken);
      if (c.action === "match") taken.add(c.id);
      accounts[a.name] = c;
    }
    const categoryMap: Record<string, CategoryChoice> = Object.fromEntries(ynabCategories(d, ["2026-08", "2026-09", "2026-10"]).map((c) => [categoryKey(c.group, c.name), suggestCategory(plan, c)]));
    const r = buildImport(plan, d, { from: "2026-10", thisMonth: "2026-11", today: TODAY, accounts, categoryMap, categories: {}, removeEmpty: true });
    applyRegisterBalances(r.plan, r.txns, TODAY);
    const cats = [
      ...r.plan.budget.map((b) => ({ key: b.id, moves: false, target: 0 })),
      ...r.plan.debts.map((x) => ({ key: "debt:" + x.id, moves: true, target: 0 })),
      { key: "cash", moves: false, target: 0 },
    ];
    const view = budgetView(liveBudget(r.plan, r.txns), cats, "2026-11", { txns: r.txns, cards: cardMap(r.plan), asOf: TODAY });
    return { r, accounts, view };
  };

  it("matches your renamed accounts instead of adding them again", () => {
    const { accounts } = run();
    expect(accounts["Bank - Checking"]).toEqual({ action: "match", id: "mine-chk" }); // same balance
    expect(accounts["Bank - Savings (Joint)"]).toEqual({ action: "match", id: "mine-sav" }); // same name but the note
    expect(accounts["Old Store Card"]).toEqual({ action: "skip" }); // closed, nothing since
  });

  it("Unassigned is YNAB's Ready to Assign", () => {
    const { view } = run();
    expect(view.readyToAssign).toBeCloseTo(YNAB_SAYS.readyToAssign, 2);
    expect(ynabReadyToAssign(d, "2026-11", TODAY)).toBeCloseTo(YNAB_SAYS.readyToAssign, 2);
    expect(view.uncategorized).toBeCloseTo(-4, 2);
    // only the coffee needs a category (starting balances never do; the held clinic waits for review)
    expect(run().r.summary.needsCategoryFromYnab).toBe(1);
  });

  it("every category and card line has what YNAB shows", () => {
    const { r, view } = run();
    const line = (name: string) => {
      const b = r.plan.budget.find((x) => x.name === name);
      const debt = r.plan.debts.find((x) => x.name === name || x.name.endsWith(name) || `${x.company ?? ""} - ${x.name}`.endsWith(name));
      return view.lines[b ? b.id : "debt:" + debt!.id]!;
    };
    for (const [name, v] of Object.entries(YNAB_SAYS.available)) expect([name, line(name).available]).toEqual([name, expect.closeTo(v, 2)]);
    const card = (n: string) => r.plan.debts.find((x) => x.name.includes(n))!;
    for (const [n, v] of Object.entries(YNAB_SAYS.cardLines)) expect([n, view.lines["debt:" + card(n).id]!.available]).toEqual([n, expect.closeTo(v, 2)]);
    // Dining went over in cash (the last purchase was cash): not left on a card
    expect(r.plan.budgetPlan!.months["2026-11"]?.cardDebt).toBeUndefined();
    // $20 taken back out of Gas
    expect(line("Gas").assigned).toBe(-20);
  });

  it("balances are YNAB's, without what isn't approved or is scheduled", () => {
    const { r } = run();
    const acct = (n: string) => r.plan.accounts.find((a) => a.name.includes(n) || a.id === `mine-${n.slice(0, 3).toLowerCase()}`)!;
    expect(acct("Checking").balance).toBeCloseTo(YNAB_SAYS.balances.Checking!, 2);
    expect(acct("Savings").balance).toBeCloseTo(YNAB_SAYS.balances.Savings!, 2);
    expect(r.plan.debts.find((x) => x.name.includes("Rewards"))!.balance).toBeCloseTo(YNAB_SAYS.balances.Rewards!, 2);
    expect(r.plan.debts.find((x) => x.name.includes("Travel"))!.balance).toBeCloseTo(YNAB_SAYS.balances.Travel!, 2);
    expect(r.plan.accounts.find((a) => a.name.includes("IRA") && a.type === "taxable")!.balance).toBeCloseTo(YNAB_SAYS.balances.IRA!, 2);
    expect(r.txns.filter((t) => t.review).map((t) => t.payee).sort()).toEqual([...YNAB_SAYS.held].sort());
    expect(registerBalance(0, r.txns, "mine-chk", false, "2099-01-01") - registerBalance(0, r.txns, "mine-chk", false, TODAY)).toBe(3000); // the scheduled pay
  });

  it("the old card's payment line goes under Closed accounts; the split, transfers and refund come in whole", () => {
    const { r } = run();
    expect(r.plan.budget.find((b) => b.name === "Old Store Card")).toMatchObject({ hidden: true, group: "Closed accounts" });
    expect(r.plan.budget.find((b) => b.name === "Gym")).toMatchObject({ hidden: true });
    expect(r.txns.find((t) => t.payee === "Costco")!.splits).toHaveLength(2);
    const pay = r.txns.filter((t) => t.date === "2026-11-16" && t.transferAccountId && !t.categoryId);
    expect(pay).toHaveLength(2);
    expect(pay[0]!.transferId).toBe(pay[1]!.id);
  });
});
