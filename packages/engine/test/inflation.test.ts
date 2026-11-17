import { describe, expect, it } from "vitest";
import { DISPLAY_INFLATION, inFutureDollars, nominalReturn } from "../src/inflation";

describe("showing numbers before inflation", () => {
  it("turns a real return into the return before inflation", () => {
    expect(DISPLAY_INFLATION).toBe(0.03);
    expect(nominalReturn(0.05)).toBeCloseTo(0.0815, 6);
    expect(nominalReturn(0, 0.03)).toBeCloseTo(0.03, 6);
    expect(nominalReturn(0.07, 0.02)).toBeCloseTo(0.0914, 6);
  });

  it("grows today's dollars into future dollars", () => {
    expect(inFutureDollars(1_000_000, 0)).toBe(1_000_000);
    expect(inFutureDollars(1_000_000, 10)).toBeCloseTo(1_343_916.38, 1);
    expect(inFutureDollars(100, 30, 0.02)).toBeCloseTo(181.136, 2);
  });

  it("never shrinks an amount for years already past", () => {
    expect(inFutureDollars(500, -3)).toBe(500);
  });
});
