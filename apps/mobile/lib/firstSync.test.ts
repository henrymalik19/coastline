import { describe, expect, it } from "vitest";
import { firstSyncAction, mergeCheckinLists } from "./firstSync";

const mine = { a: 1 };
const theirs = { a: 2 };

describe("first sync of a plan on a device", () => {
  it("asks when both have a finished plan and they differ, even when this device's is newer", () => {
    expect(firstSyncAction({ plan: mine, onboarded: true, updatedAt: 200 }, { plan: theirs, onboarded: true, at: 100 })).toBe("ask");
    expect(firstSyncAction({ plan: mine, onboarded: true, updatedAt: 100 }, { plan: theirs, onboarded: true, at: 200 })).toBe("ask");
  });
  it("doesn't ask when the two plans are the same", () => {
    expect(firstSyncAction({ plan: { a: 1 }, onboarded: true, updatedAt: 200 }, { plan: { a: 1 }, onboarded: true, at: 100 })).toBe("keep");
    expect(firstSyncAction({ plan: { a: 1 }, onboarded: true, updatedAt: 100 }, { plan: { a: 1 }, onboarded: true, at: 200 })).toBe("account");
  });
  it("takes the account's plan quietly when this device's setup isn't finished", () => {
    expect(firstSyncAction({ plan: mine, onboarded: false, updatedAt: 999 }, { plan: theirs, onboarded: true, at: 1 })).toBe("account");
  });
  it("keeps this device's finished plan when the account's isn't finished", () => {
    expect(firstSyncAction({ plan: mine, onboarded: true, updatedAt: 200 }, { plan: theirs, onboarded: false, at: 100 })).toBe("keep");
  });
  it("follows the person's pick", () => {
    const local = { plan: mine, onboarded: true, updatedAt: 200 };
    const remote = { plan: theirs, onboarded: true, at: 100 };
    expect(firstSyncAction(local, remote, "account")).toBe("account");
    expect(firstSyncAction(local, remote, "device")).toBe("device");
  });
});

describe("check-ins between devices", () => {
  const c = (month: string, invested: number, updatedAt?: number) => ({ month, invested, cash: 0, debt: 0, netWorth: 0, expectedNextInvested: 0, ...(updatedAt ? { updatedAt } : {}) });
  it("a fix made on another device replaces this device's older copy of the month", () => {
    const next = mergeCheckinLists([c("2026-10", 100, 5)], [c("2026-10", 120, 9)]);
    expect(next?.[0]?.invested).toBe(120);
  });
  it("keeps this device's newer copy, and brings in months it doesn't have", () => {
    const next = mergeCheckinLists([c("2026-10", 100, 9)], [c("2026-10", 120, 5), c("2026-09", 80, 1)]);
    expect(next?.map((x) => [x.month, x.invested])).toEqual([["2026-09", 80], ["2026-10", 100]]);
  });
  it("changes nothing when this device is up to date", () => {
    expect(mergeCheckinLists([c("2026-10", 100, 9)], [c("2026-10", 100, 9)])).toBeNull();
  });
});
