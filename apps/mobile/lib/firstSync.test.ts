import { describe, expect, it } from "vitest";
import { firstSyncAction } from "./firstSync";

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
