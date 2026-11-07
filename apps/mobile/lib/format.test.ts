import { describe, expect, it } from "vitest";
import { money } from "./format";

describe("money", () => {
  it("shows exact amounts: cents only when there are any", () => {
    expect(money(2345.67)).toBe("$2,345.67");
    expect(money(2345)).toBe("$2,345");
    expect(money(2345.5)).toBe("$2,345.50");
    expect(money(1326411.37)).toBe("$1,326,411.37");
    expect(money(-12.3)).toBe("−$12.30");
    expect(money(0)).toBe("$0");
  });
  it("whole: dollars only (estimates); compact: short form (charts)", () => {
    expect(money(1326411.37, { whole: true })).toBe("$1,326,411");
    expect(money(-0.4, { whole: true })).toBe("$0");
    expect(money(1326411, { compact: true })).toBe("$1.33M");
    expect(money(45200, { compact: true })).toBe("$45k");
  });
});
