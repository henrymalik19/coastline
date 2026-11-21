import { describe, expect, it } from "vitest";
import { rentalMonthly } from "../src";

describe("a rental's monthly numbers", () => {
  it("turns the rent into a monthly amount and subtracts the mortgage", () => {
    expect(rentalMonthly({ net: 2000, freq: "monthly" }, 1500)).toEqual({ rent: 2000, keep: 500 });
    expect(rentalMonthly({ net: 500, freq: "weekly" }, 2500).keep).toBeCloseTo(500 * 52 / 12 - 2500);
  });
});
