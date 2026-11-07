import { describe, expect, it } from "vitest";
import type { Income } from "@coastfi/engine";
import { estimateAnnualTaxes, estimateBracket, estimatePaycheckTaxes, estimateTaxRate, federalBracket, federalIncomeTax } from "./tax";

describe("federalIncomeTax", () => {
  it("applies brackets progressively", () => {
    expect(federalIncomeTax(0)).toBe(0);
    expect(federalIncomeTax(10_000)).toBeCloseTo(1_000, 6);
    // 11,925 × 10% + (48,475 − 11,925) × 12%
    expect(federalIncomeTax(48_475)).toBeCloseTo(1_192.5 + 4_386, 6);
  });
});

describe("estimateTaxRate", () => {
  it("is 0 with no pay", () => {
    expect(estimateTaxRate(0)).toBe(0);
  });

  it("$91k single, no 401(k): federal + FICA + 4% state", () => {
    const gross = 91_000;
    const taxable = gross - 15_750; // 75,250
    const federal = 1_192.5 + (48_475 - 11_925) * 0.12 + (taxable - 48_475) * 0.22;
    const expected = (federal + gross * 0.0765 + gross * 0.04) / gross;
    expect(estimateTaxRate(gross)).toBeCloseTo(expected, 9);
    expect(estimateTaxRate(gross)).toBeGreaterThan(0.2);
    expect(estimateTaxRate(gross)).toBeLessThan(0.3);
  });

  it("a pre-tax 401(k) lowers income tax but not Social Security / Medicare", () => {
    const without = estimateTaxRate(91_000);
    const withK = estimateTaxRate(91_000, 9_100);
    expect(withK).toBeLessThan(without);
    // the cut is at most the 22% bracket + 4% state on the 401(k) dollars
    expect((without - withK) * 91_000).toBeLessThanOrEqual(9_100 * 0.26 + 1e-6);
  });

  it("rises with income", () => {
    expect(estimateTaxRate(250_000)).toBeGreaterThan(estimateTaxRate(90_000));
    expect(estimateTaxRate(90_000)).toBeGreaterThan(estimateTaxRate(40_000));
  });
});

describe("estimatePaycheckTaxes", () => {
  it("splits a year's estimate into per-check federal / state / SS / Medicare", () => {
    const t = estimatePaycheckTaxes(3500, 26, 140);
    const annual = estimateAnnualTaxes({ gross: 3500 * 26, pretax: 140 * 26 });
    expect(t.socialSecurity).toBeCloseTo(3500 * 0.062, 2);
    expect(t.medicare).toBeCloseTo(3500 * 0.0145, 2);
    expect(t.federal).toBeCloseTo(annual.federal / 26, 2);
    expect(t.state).toBeCloseTo(((3500 - 140) * 26 * 0.04) / 26, 2);
  });
});

describe("filing status", () => {
  it("married filing jointly with one earner owes much less federal tax than single", () => {
    const single = estimateAnnualTaxes({ gross: 91_000, pretax: 0 }, "single").federal;
    const mfj = estimateAnnualTaxes({ gross: 91_000, pretax: 0 }, "mfj").federal;
    // 91,000 − 31,500 = 59,500 taxable: 23,850 × 10% + 35,650 × 12%
    expect(mfj).toBeCloseTo(2_385 + 35_650 * 0.12, 6);
    expect(single - mfj).toBeGreaterThan(3_000);
  });

  it("head of household sits between single and married", () => {
    const f = (s: "single" | "mfj" | "hoh") => estimateAnnualTaxes({ gross: 91_000, pretax: 0 }, s).federal;
    expect(f("hoh")).toBeLessThan(f("single"));
    expect(f("hoh")).toBeGreaterThan(f("mfj"));
  });

  it("two jobs on one joint return: federal tax is figured together and split by pay", () => {
    const a = { gross: 90_000, pretax: 0 };
    const b = { gross: 30_000, pretax: 0 };
    const fa = estimateAnnualTaxes(a, "mfj", [b]).federal;
    const fb = estimateAnnualTaxes(b, "mfj", [a]).federal;
    const together = federalIncomeTax(120_000 - 31_500, "mfj");
    expect(fa + fb).toBeCloseTo(together, 6);
    expect(fa / (fa + fb)).toBeCloseTo(0.75, 9);
  });

  it("Social Security and Medicare don't depend on filing status or other jobs", () => {
    const x = estimateAnnualTaxes({ gross: 91_000, pretax: 5_000 }, "mfj", [{ gross: 50_000, pretax: 0 }]);
    expect(x.socialSecurity).toBeCloseTo(91_000 * 0.062, 6);
    expect(x.medicare).toBeCloseTo(91_000 * 0.0145, 6);
  });
});

describe("estimateBracket", () => {
  const job: Income = {
    id: "j", name: "Job", kind: "job", freq: "biweekly", net: 2500, matchMode: "pct", gross: 3500, contribPct: 0.05,
    deductions: [{ id: "h", kind: "health", amount: 110 }],
  };

  it("is null with no income", () => {
    expect(estimateBracket([], "single")).toBeNull();
  });

  it("uses gross − 401(k) − pre-tax deductions − standard deduction", () => {
    // 3,500 × 26 = 91,000 − 4,550 (401k) − 2,860 (health) = 83,590 − 15,750 = 67,840 → 22%
    const e = estimateBracket([job], "single")!;
    expect(e.taxable).toBeCloseTo(67_840, 6);
    expect(e.federal).toBe(0.22);
    expect(e.total).toBeCloseTo(0.26, 9);
  });

  it("depends on filing status and counts every job on the return", () => {
    expect(estimateBracket([job], "mfj")!.federal).toBe(0.12);
    expect(estimateBracket([job, { ...job, id: "k" }], "mfj")!.federal).toBe(0.22);
  });

  it("counts take-home for incomes without gross pay", () => {
    const rental: Income = { id: "r", name: "Rental", kind: "rental", freq: "monthly", net: 2_000, matchMode: "usd" };
    expect(estimateBracket([rental], "single")!.taxable).toBeCloseTo(24_000 - 15_750, 6);
  });

  it("is the lowest bracket when income is under the standard deduction", () => {
    expect(federalBracket(0)).toBe(0.1);
    expect(federalBracket(1_000_000)).toBe(0.37);
  });
});
