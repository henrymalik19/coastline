import { describe, expect, it } from "vitest";
import { importWait } from "./importWait";

describe("the YNAB import waits for syncing", () => {
  it("goes ahead when this device isn't signed in", () => {
    expect(importWait({ status: "signedOut" })).toBeNull();
    expect(importWait({ status: "off", userId: "u" })).toBeNull();
  });
  it("waits while syncing or a big upload is under way", () => {
    expect(importWait({ status: "syncing", userId: "u", lastSyncedAt: 1 })).toMatch(/sync/);
    expect(importWait({ status: "synced", userId: "u", lastSyncedAt: 1, progress: "Saving transactions: 500 of 8,000" })).toMatch(/sync/);
  });
  it("waits until your account has loaded on this device", () => {
    expect(importWait({ status: "error", userId: "u" })).toMatch(/Loading/);
    expect(importWait({ status: "offline", userId: "u" })).toMatch(/Connect/);
  });
  it("goes ahead once loaded, even offline (it syncs later)", () => {
    expect(importWait({ status: "synced", userId: "u", lastSyncedAt: 1 })).toBeNull();
    expect(importWait({ status: "offline", userId: "u", lastSyncedAt: 1 })).toBeNull();
  });
});
