import { describe, expect, it } from "vitest";
import { formatDate, parseDate } from "./dates";

const TODAY = new Date(2026, 10, 6);

describe("parseDate", () => {
  it.each([
    ["2026-11-20", "2026-11-20"],
    ["2026/11/20", "2026-11-20"],
    ["11/20/2026", "2026-11-20"],
    ["11-20-2026", "2026-11-20"],
    ["11.20.2026", "2026-11-20"],
    ["11/20/26", "2026-11-20"],
    ["1/5/27", "2027-01-05"],
    ["11/20", "2026-11-20"],
    ["Nov 20 2026", "2026-11-20"],
    ["November 20, 2026", "2026-11-20"],
    ["nov 20th", "2026-11-20"],
    ["Dec. 4", "2026-12-04"],
    ["20 Nov 2026", "2026-11-20"],
    ["  11/20/2026  ", "2026-11-20"],
  ])("%s → %s", (input, iso) => {
    expect(parseDate(input, TODAY)).toBe(iso);
  });

  it.each(["", "hello", "13/01/2026", "2/30/2026", "2026-02-30", "Smarch 4", "11/20/20266"])("rejects %j", (input) => {
    expect(parseDate(input, TODAY)).toBeNull();
  });

  it("leap days", () => {
    expect(parseDate("2/29/2028", TODAY)).toBe("2028-02-29");
    expect(parseDate("2/29/2027", TODAY)).toBeNull();
  });
});

describe("formatDate", () => {
  it("formats ISO for display", () => {
    expect(formatDate("2026-11-20")).toBe("Nov 20, 2026");
    expect(formatDate(undefined)).toBe("");
  });
});
