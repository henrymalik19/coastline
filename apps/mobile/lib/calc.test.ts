import { describe, expect, it } from "vitest";
import { calc, mathChars } from "./calc";

describe("math in a number box", () => {
  it("adds, takes away, multiplies and divides, times before plus", () => {
    expect(calc("120+35.50")).toBe(155.5);
    expect(calc("1,200 − 85")).toBe(1115);
    expect(calc("60*12")).toBe(720);
    expect(calc("1500/2")).toBe(750);
    expect(calc("10+2×3")).toBe(16);
    expect(calc("100-20-5")).toBe(75);
    expect(calc("0.1+0.2")).toBe(0.3);
    expect(calc("42")).toBe(42);
  });
  it("a leading operator works on what was there", () => {
    expect(calc("+50", 100)).toBe(150);
    expect(calc("-30", 100)).toBe(70);
    expect(calc("*2", 100)).toBe(200);
    // where it can go negative, a leading minus is a negative number
    expect(calc("-30", 100, true)).toBe(-30);
  });
  it("isn't a number yet while a sum is unfinished, or divides by zero", () => {
    expect(calc("120+")).toBeNull();
    expect(calc("")).toBeNull();
    expect(calc("5/0")).toBeNull();
    expect(calc("5++3")).toBeNull();
  });
  it("keeps digits, a point and the operators", () => {
    expect(mathChars("$1,200 + 3a")).toBe("1200+3");
    expect(mathChars("1.5*2", false)).toBe("15*2");
  });
});
