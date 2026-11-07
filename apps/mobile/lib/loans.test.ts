import type { Income, PlanState } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { paycheckFor, syncPaycheckLoans } from "./loans";
import { paycheck } from "./paycheck";

const job = (deductions: Income["deductions"]): Income => ({
  id: "j", name: "Acme", kind: "job", freq: "biweekly", net: 0, netMode: "auto", matchMode: "pct", gross: 3000, contribPct: 0.05,
  taxes: { federal: 300, state: 100, socialSecurity: 186, medicare: 43.5 }, deductions,
});
const plan = (inc: Income): PlanState => ({ incomes: [inc], debts: [] }) as unknown as PlanState;

describe("paycheck 401(k) loans", () => {
  it("turning the loan on creates a linked 401(k) loan debt with the monthly payment", () => {
    const p = plan(job([{ id: "l", kind: "k401_loan", amount: 120 }]));
    syncPaycheckLoans(p);
    expect(p.debts).toHaveLength(1);
    const debt = p.debts[0]!;
    expect(debt).toMatchObject({ kind: "k401_loan", name: "Acme 401(k) loan", minPayment: 260 }); // 120 × 26 ÷ 12
    expect(p.incomes[0]!.deductions![0]!.debtId).toBe(debt.id);
    expect(paycheckFor(p, debt.id)?.income.id).toBe("j");
  });

  it("the debt's payment follows the paycheck amount", () => {
    const p = plan(job([{ id: "l", kind: "k401_loan", amount: 120 }]));
    syncPaycheckLoans(p);
    p.incomes[0]!.deductions![0]!.amount = 60;
    syncPaycheckLoans(p);
    expect(p.debts).toHaveLength(1);
    expect(p.debts[0]!.minPayment).toBe(130);
  });

  it("removing the debt removes the repayment from the paycheck", () => {
    const p = plan(job([{ id: "l", kind: "k401_loan", amount: 120 }, { id: "h", kind: "health", amount: 50 }]));
    syncPaycheckLoans(p);
    p.debts = [];
    syncPaycheckLoans(p);
    expect(p.incomes[0]!.deductions!.map((d) => d.kind)).toEqual(["health"]);
  });

  it("take-home leaves the repayment in (it's counted once, as the debt payment)", () => {
    const withLoan = paycheck(job([{ id: "l", kind: "k401_loan", amount: 120 }]));
    const without = paycheck(job([]));
    expect(withLoan.net).toBe(without.net);
    expect(withLoan.loanRepayment).toBe(120);
  });
});

describe("linking a 401(k) loan added on the Debts page", () => {
  it("a repayment pointing at an existing debt keeps that debt and sets its monthly payment", () => {
    const p = plan(job([{ id: "l", kind: "k401_loan", amount: 150, debtId: "d1" }]));
    p.debts.push({ id: "d1", name: "My loan", kind: "k401_loan", balance: 8000, apr: 0.075, minPayment: 0 });
    syncPaycheckLoans(p);
    expect(p.debts).toHaveLength(1);
    expect(p.debts[0]).toMatchObject({ id: "d1", name: "My loan", balance: 8000, minPayment: 325 }); // 150 × 26 ÷ 12
  });
});
