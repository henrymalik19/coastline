import { describe, expect, it } from "vitest";
import { estimateAnnualTaxes, estimatePaycheckTaxes, estimateTaxRate, federalIncomeTax } from "./tax";

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
    const annual = estimateAnnualTaxes(3500 * 26, 140 * 26);
    expect(t.socialSecurity).toBeCloseTo(3500 * 0.062, 2);
    expect(t.medicare).toBeCloseTo(3500 * 0.0145, 2);
    expect(t.federal).toBeCloseTo(annual.federal / 26, 2);
    expect(t.state).toBeCloseTo(((3500 - 140) * 26 * 0.04) / 26, 2);
  });
});
