import { describe, expect, it } from "vitest";
import { defaultPlanState } from "@coastfi/schema";
import { applyBankBalances, dropMatches, matchOf, newFromBank, setMatch, type BankAccount } from "./plaidMatch";

const bank = (o: Partial<BankAccount>): BankAccount => ({ id: "r", item: "i", accountId: "acc", name: "Acct", type: "depository", current: 100, ...o });
const plan = () => {
  const p = defaultPlanState();
  p.accounts = [
    { id: "chk", name: "Checking", type: "cash", balance: 50 },
    { id: "k", name: "401(k)", type: "pretax", balance: 1000, counts: "k401" },
  ];
  p.debts = [{ id: "card", name: "Visa", kind: "credit_card", balance: 300, apr: 0, minPayment: 0 }];
  return p;
};

describe("newFromBank", () => {
  it("guesses the account type from the bank's", () => {
    expect(newFromBank(bank({ type: "depository" }), "x")).toMatchObject({ kind: "account", account: { type: "cash", balance: 100, plaidAccountId: "acc" } });
    // the bank's name becomes the company
    expect(newFromBank(bank({ type: "depository" }), "x", "Chase")).toMatchObject({ account: { company: "Chase" } });
    expect(newFromBank(bank({ type: "credit" }), "x", "Chase")).toMatchObject({ debt: { company: "Chase" } });
    expect(newFromBank(bank({ type: "investment", subtype: "401k" }), "x")).toMatchObject({ account: { type: "pretax", counts: "k401" } });
    expect(newFromBank(bank({ type: "investment", subtype: "roth" }), "x")).toMatchObject({ account: { type: "roth", counts: "ira" } });
    expect(newFromBank(bank({ type: "investment", subtype: "ira" }), "x")).toMatchObject({ account: { type: "pretax", counts: "ira" } });
    expect(newFromBank(bank({ type: "investment", subtype: "hsa" }), "x")).toMatchObject({ account: { type: "hsa" } });
    expect(newFromBank(bank({ type: "investment", subtype: "brokerage" }), "x")).toMatchObject({ account: { type: "taxable" } });
  });
  it("makes a card or loan a debt, with the rate and minimum when shared", () => {
    expect(newFromBank(bank({ type: "credit", current: 410.555, apr: 0.2399, minPayment: 35 }), "x")).toMatchObject({ kind: "debt", debt: { kind: "credit_card", balance: 410.56, apr: 0.2399, minPayment: 35 } });
    expect(newFromBank(bank({ type: "loan", subtype: "student" }), "x")).toMatchObject({ debt: { kind: "student" } });
    expect(newFromBank(bank({ type: "loan", subtype: "mortgage" }), "x")).toMatchObject({ debt: { kind: "mortgage" } });
  });
});

describe("setMatch / matchOf", () => {
  it("one bank account matches one plan account or debt, and can move", () => {
    const p = plan();
    setMatch(p, { accountId: "acc" }, { kind: "account", id: "chk" });
    expect(matchOf(p, { accountId: "acc" })).toMatchObject({ kind: "account", item: { id: "chk" } });
    setMatch(p, { accountId: "acc" }, { kind: "debt", id: "card" });
    expect(p.accounts[0]!.plaidAccountId).toBeUndefined();
    expect(matchOf(p, { accountId: "acc" })).toMatchObject({ kind: "debt", item: { id: "card" } });
    setMatch(p, { accountId: "acc" }, null);
    expect(matchOf(p, { accountId: "acc" })).toBeNull();
  });
});

describe("applyBankBalances", () => {
  it("copies balances into matched accounts and debts, and fills a debt's missing rate and minimum", () => {
    const p = plan();
    p.accounts[0]!.plaidAccountId = "a1";
    p.accounts[1]!.plaidAccountId = "a2";
    p.debts[0]!.plaidAccountId = "a3";
    const changed = applyBankBalances(p, [bank({ accountId: "a1", current: 1234.5 }), bank({ accountId: "a2", type: "investment", current: 2000 }), bank({ accountId: "a3", type: "credit", current: 410, apr: 0.2, minPayment: 25 })], () => false);
    expect(changed).toBe(true);
    expect(p.accounts.map((a) => a.balance)).toEqual([1234.5, 2000]);
    expect(p.debts[0]).toMatchObject({ balance: 410, apr: 0.2, minPayment: 25 });
  });
  it("leaves a register account alone, keeps a rate you set, and reports no change when nothing differs", () => {
    const p = plan();
    p.accounts[0]!.plaidAccountId = "a1";
    p.debts[0]!.plaidAccountId = "a3";
    p.debts[0]!.apr = 0.1;
    const b = [bank({ accountId: "a1", current: 999 }), bank({ accountId: "a3", type: "credit", current: 300, apr: 0.25 })];
    expect(applyBankBalances(p, b, (id) => id === "chk")).toBe(false);
    expect(p.accounts[0]!.balance).toBe(50);
    expect(p.debts[0]!.apr).toBe(0.1);
  });
});

describe("dropMatches", () => {
  it("unmatches the accounts of a disconnected bank", () => {
    const p = plan();
    p.accounts[0]!.plaidAccountId = "a1";
    expect(dropMatches(p, ["a1"])).toBe(true);
    expect(p.accounts[0]!.plaidAccountId).toBeUndefined();
    expect(dropMatches(p, ["a1"])).toBe(false);
  });
});
