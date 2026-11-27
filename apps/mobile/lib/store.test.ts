// The store's saved copy: reading it back (one bad item never blanks the plan), not writing before it's
// read, and edit times across devices. AsyncStorage is a plain in-memory map here.
import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => disk.get(k) ?? null,
    setItem: async (k: string, v: string) => void disk.set(k, v),
    removeItem: async (k: string) => void disk.delete(k),
  },
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, AppState: { addEventListener: () => ({ remove: () => undefined }) } }));
const kept = new Map<string, string>();
vi.stubGlobal("localStorage", { setItem: (k: string, v: string) => void kept.set(k, v) });

const { useStore } = await import("./store");
const { freshPlan } = await import("./presets");

const save = (state: Record<string, unknown>) => disk.set("coastfi.app", JSON.stringify({ state, version: 1 }));
const reload = async () => {
  await useStore.persist.rehydrate();
  return useStore.getState();
};
const txn = (id: string, updatedAt: number) => ({ id, accountId: "chk", date: "2026-11-01", amount: -5, cleared: "cleared", source: "manual", updatedAt });

beforeEach(() => {
  disk.clear();
  kept.clear();
});

describe("reading the device's saved copy", () => {
  it("drops one bad category, keeps the rest of the plan, and says so", async () => {
    const plan = freshPlan() as unknown as { budget: unknown[] };
    const n = plan.budget.length;
    plan.budget.push({ id: "broken", name: 5 });
    save({ plan, onboarded: true, updatedAt: 10, txns: [txn("a", 1), { id: "bad" }] });
    const s = await reload();
    expect(s.onboarded).toBe(true);
    expect(s.plan.budget.length).toBe(n);
    expect(s.txns.map((t) => t.id)).toEqual(["a"]);
    expect(s.loadNotice).toMatch(/2 saved items/);
  });

  it("a finished plan that can't be read at all goes back to the last synced copy", async () => {
    const base = freshPlan();
    base.age = 41;
    save({ plan: { version: 2, age: "old" }, onboarded: true, updatedAt: 99, syncBase: { owner: "u1", at: 50, plan: base, todoDone: {} } });
    const s = await reload();
    expect(s.onboarded).toBe(true);
    expect(s.plan.age).toBe(41);
    // as old as the synced copy: never the newer one, so it can't replace the account's plan
    expect(s.updatedAt).toBe(50);
    expect([...kept.keys()].some((k) => k.startsWith("coastfi.app.damaged"))).toBe(true);
  });

  it("without a synced copy, leaves setup unfinished (uploads nothing; the account's plan wins)", async () => {
    save({ plan: { version: 2, age: "old" }, onboarded: true, updatedAt: 99 });
    const s = await reload();
    expect(s.onboarded).toBe(false);
    expect(s.updatedAt).toBe(0);
    expect(s.loadNotice).toMatch(/setup starts again/);
  });
});

describe("edit times", () => {
  it("an edit after taking in a fast-clock device's transaction gets a later time", async () => {
    save({ plan: freshPlan(), onboarded: true, txns: [] });
    await reload();
    const ahead = Date.now() + 10 * 60_000;
    useStore.getState().mergeTxns([txn("theirs", ahead) as never]);
    useStore.getState().saveTxn({ id: "mine", accountId: "chk", date: "2026-11-02", amount: -3, cleared: "uncleared", source: "manual" }, "2026-11-02");
    const mine = useStore.getState().txns.find((t) => t.id === "mine")!;
    expect(mine.updatedAt).toBeGreaterThan(ahead);
  });
});

describe("the outbox in the store", () => {
  it("queues this device's edits, not the server's", async () => {
    save({ plan: freshPlan(), onboarded: true, txns: [] });
    await reload();
    useStore.setState({ outbox: [] });
    useStore.getState().mergeTxns([txn("from-server", 5) as never]);
    expect(useStore.getState().outbox).toEqual([]);
    useStore.getState().saveTxn({ id: "mine", accountId: "chk", date: "2026-11-02", amount: -3, cleared: "uncleared", source: "manual" }, "2026-11-02");
    expect(useStore.getState().outbox).toEqual(["mine"]);
    useStore.getState().deleteTxn("from-server");
    expect(useStore.getState().outbox).toEqual(["mine", "from-server"]);
  });
  it("an older saved copy gets its outbox from the old marker", async () => {
    save({ plan: freshPlan(), onboarded: true, txns: [txn("up", 5), txn("waiting", 15)], txnPushed: { owner: "u1", at: 10 } });
    const s = await reload();
    expect(s.outbox).toEqual(["waiting"]);
  });
  it("a marker for another plan doesn't count: everything is queued, as the old code would have sent it all", async () => {
    const base = { owner: "u1", at: 1, plan: freshPlan(), todoDone: {} };
    save({ plan: freshPlan(), onboarded: true, syncBase: base, txns: [txn("a", 5), txn("b", 15)], txnPushed: { owner: "someone-else", at: 10 } });
    const s = await reload();
    expect(s.outbox).toEqual(["a", "b"]);
  });
});

describe("starting an account's transactions", () => {
  it("on a day you pick, with its balance then; the balance then follows its transactions", () => {
    const plan = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 900 }];
    plan.debts = [{ id: "visa", name: "Visa", kind: "credit_card", balance: 300, apr: 0.2, minPayment: 25 }];
    plan.budgetPlan = { start: "2026-11", startCash: 0, months: {} };
    useStore.setState({ plan, txns: [] });
    useStore.getState().startTxns("chk", "2026-09-15", 1200);
    useStore.getState().startTxns("visa", "2026-10-01", 250);
    const s = useStore.getState();
    expect(s.txns.map((t) => [t.id, t.date, t.amount, t.categoryId])).toEqual([["start:visa", "2026-10-01", -250, undefined], ["start:chk", "2026-09-15", 1200, "ready"]]);
    expect([s.plan.accounts[0]!.balance, s.plan.debts[0]!.balance]).toEqual([1200, 250]);
    // only once
    useStore.getState().startTxns("chk", "2026-11-01", 5);
    expect(useStore.getState().txns.find((t) => t.id === "start:chk")!.amount).toBe(1200);
  });
});
