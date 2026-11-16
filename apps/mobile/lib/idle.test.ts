import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));
const { awayTooLong } = await import("./idle");

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 16);

describe("signing out devices that haven't been used", () => {
  it("keeps a device used recently", () => {
    expect(awayTooLong(now - 29 * DAY, now)).toBe(false);
    expect(awayTooLong(now - 30 * DAY, now)).toBe(false);
  });
  it("signs out a device unused for more than 30 days", () => {
    expect(awayTooLong(now - 30 * DAY - 1, now)).toBe(true);
    expect(awayTooLong(now - 200 * DAY, now)).toBe(true);
  });
  it("never signs out a device with no record of use yet", () => {
    expect(awayTooLong(undefined, now)).toBe(false);
    expect(awayTooLong(Number.NaN, now)).toBe(false);
  });
});
