import { describe, expect, it } from "vitest";
import { companiesIn, fullName, othersWith, renameCompany, splitCompanies, suggestCompanies } from "./company";

describe("the company an account is with", () => {
  it("shows before the name, and falls back when there's no name", () => {
    expect(fullName({ name: "Sapphire", company: "Chase" })).toBe("Chase · Sapphire");
    expect(fullName({ name: "Sapphire" })).toBe("Sapphire");
    expect(fullName({ name: " ", company: "Chase" }, "Credit card")).toBe("Chase · Credit card");
    expect(fullName({ name: "", company: " " }, "Cash")).toBe("Cash");
  });

  it("YNAB-style names split only where two or more share the part before the dash", () => {
    const r = splitCompanies(["Chase - Sapphire", "Chase – Amazon Rewards Visa", "Fidelity - CMA", "EquityLine – 6489", "My Checking"]);
    expect(r["Chase - Sapphire"]).toEqual({ company: "Chase", name: "Sapphire" });
    expect(r["Chase – Amazon Rewards Visa"]).toEqual({ company: "Chase", name: "Amazon Rewards Visa" });
    expect(r["Fidelity - CMA"]).toEqual({ name: "Fidelity - CMA" });
    expect(r["EquityLine – 6489"]).toEqual({ name: "EquityLine – 6489" });
    expect(r["My Checking"]).toEqual({ name: "My Checking" });
  });

  it("suggests the ones you use, and renames one everywhere", () => {
    const p = {
      accounts: [{ id: "a", name: "Checking", company: "Chase", type: "cash" as const, balance: 0 }, { id: "b", name: "Savings", company: "Ally", type: "cash" as const, balance: 0 }],
      debts: [{ id: "c", name: "Sapphire", company: "chase", balance: 0, apr: 0, minPayment: 0 }],
    };
    expect(companiesIn(p)).toEqual(["Ally", "Chase"]);
    expect(suggestCompanies(companiesIn(p), "ch")).toEqual(["Chase"]);
    expect(suggestCompanies(companiesIn(p), "chase")).toEqual([]);
    expect(othersWith(p, "Chase", "a")).toBe(1);
    renameCompany(p, "Chase", "JPMorgan Chase");
    expect([p.accounts[0]!.company, p.debts[0]!.company, p.accounts[1]!.company]).toEqual(["JPMorgan Chase", "JPMorgan Chase", "Ally"]);
    renameCompany(p, "Ally", "");
    expect(p.accounts[1]!.company).toBeUndefined();
  });
});
