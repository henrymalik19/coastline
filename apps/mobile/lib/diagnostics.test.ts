import type { Txn } from "@coastfi/engine";
import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, AppState: { addEventListener: () => ({ remove: () => undefined }) } }));
vi.mock("./store", () => ({ useStore: { getState: () => ({}) } }));
vi.mock("./sync", () => ({ useSync: { getState: () => ({}) } }));
vi.mock("./supabase", () => ({ supabase: null }));
const { reportFrom, reportText } = await import("./diagnostics");

const tx = (id: string, p: Partial<Txn> = {}): Txn => ({ id, accountId: "chk", date: "2026-11-01", amount: -5, cleared: "cleared", source: "manual", updatedAt: 10, ...p }) as Txn;

describe("diagnostics", () => {
  it("counts what's here and what's waiting to upload, with no amounts or names", () => {
    const r = reportFrom({
      txns: [tx("a"), tx("b", { accountId: "outside:Old", payee: "Secret Shop" }), tx("c", { deleted: true }), tx("d", { updatedAt: 50 })],
      accounts: 3, debts: 1, categories: 20, checkins: 2, pushedAt: 20,
      sync: { status: "synced", lastSyncedAt: Date.UTC(2026, 10, 19) },
    });
    expect(r).toMatchObject({ transactions: 3, history: 1, deletedKept: 1, waitingToUpload: 1, accounts: 3, syncStatus: "synced", lastSynced: "2026-11-19T00:00:00.000Z", importedAt: null });
    const text = reportText(r);
    expect(text).toContain("transactions: 3");
    expect(text).not.toContain("Secret");
    expect(text).not.toContain("-5");
  });
});
