import type { Txn } from "@coastfi/engine";
import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));
const { historySig, splitStorage, textShelf } = await import("./txnStorage");

const memText = () => {
  const m = new Map<string, string>();
  return { m, getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), removeItem: async (k: string) => void m.delete(k) };
};
const memShelf = () => {
  const s = { v: undefined as unknown, writes: 0, get: async () => s.v, set: async (v: unknown) => { s.v = v; s.writes++; } };
  return s;
};
const tx = (id: string, accountId: string, updatedAt = 1): Txn => ({ id, accountId, date: "2021-07-01", amount: -10, cleared: "cleared", source: "ynab", updatedAt }) as Txn;
const val = (txns: Txn[]) => ({ state: { txns, plan: "p" }, version: 1 });

describe("splitStorage", () => {
  it("keeps history apart from the everyday entry, and puts them together when read", async () => {
    const text = memText();
    const shelf = memShelf();
    const st = splitStorage<{ txns: Txn[]; plan: string }>("app", text, shelf);
    await st.setItem("app", val([tx("a", "chk"), tx("h1", "outside:Old Card"), tx("h2", "outside:Old Card")]));
    const saved = JSON.parse(text.m.get("app")!);
    expect(saved.state.txns.map((t: Txn) => t.id)).toEqual(["a"]);
    expect((shelf.v as Txn[]).map((t) => t.id)).toEqual(["h1", "h2"]);
    const back = await splitStorage<{ txns: Txn[]; plan: string }>("app", text, shelf).getItem("app");
    expect(back!.state.txns.map((t) => t.id)).toEqual(["a", "h1", "h2"]);
    expect(back!.state.plan).toBe("p");
  });

  it("writes history only when it changes", async () => {
    const shelf = memShelf();
    const st = splitStorage<{ txns: Txn[]; plan: string }>("app", memText(), shelf);
    const h = [tx("h1", "outside:Old")];
    await st.setItem("app", val([tx("a", "chk", 1), ...h]));
    await st.setItem("app", val([tx("a", "chk", 2), ...h]));
    expect(shelf.writes).toBe(1);
    await st.setItem("app", val([tx("a", "chk", 2), tx("h1", "outside:Old", 5)]));
    expect(shelf.writes).toBe(2);
  });

  it("only the newest of a burst of saves is written after the one under way", async () => {
    const text = memText();
    const st = splitStorage<{ txns: Txn[]; plan: string }>("app", text, memShelf());
    const spy = vi.spyOn(text, "setItem");
    const all = [1, 2, 3, 4].map((n) => st.setItem("app", val([tx("a", "chk", n)])));
    await Promise.all(all);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(text.m.get("app")!).state.txns[0].updatedAt).toBe(4);
  });

  it("moves history out of an older save that still has it", async () => {
    const text = memText();
    const shelf = memShelf();
    text.m.set("app", JSON.stringify(val([tx("a", "chk"), tx("h1", "outside:Old")])));
    const st = splitStorage<{ txns: Txn[]; plan: string }>("app", text, shelf);
    const v = await st.getItem("app");
    expect(v!.state.txns).toHaveLength(2);
    await st.setItem("app", v!);
    expect(JSON.parse(text.m.get("app")!).state.txns).toHaveLength(1);
    expect(shelf.v as Txn[]).toHaveLength(1);
  });

  it("history that can't be kept apart is saved with everything else, and moves out once it can", async () => {
    const text = memText();
    let fail = true;
    const shelf = { v: undefined as unknown, get: async () => shelf.v, set: async (v: unknown) => { if (fail) throw new Error("full"); shelf.v = v; } };
    const st = splitStorage<{ txns: Txn[]; plan: string }>("app", text, shelf);
    await st.setItem("app", val([tx("a", "chk"), tx("h1", "outside:Old")]));
    expect(JSON.parse(text.m.get("app")!).state.txns).toHaveLength(2);
    fail = false;
    await st.setItem("app", val([tx("a", "chk", 2), tx("h1", "outside:Old")]));
    expect(shelf.v as Txn[]).toHaveLength(1);
    expect(JSON.parse(text.m.get("app")!).state.txns).toHaveLength(1);
  });

  it("history alone (no everyday entry) still loads", async () => {
    const shelf = memShelf();
    shelf.v = [tx("h1", "outside:Old")];
    const v = await splitStorage<{ txns: Txn[]; plan: string }>("app", memText(), shelf).getItem("app");
    expect(v!.state.txns).toHaveLength(1);
  });

  it("textShelf stores a list and removes its entry when empty", async () => {
    const text = memText();
    const s = textShelf(text, "h");
    await s.set([tx("h1", "outside:Old")]);
    expect(await s.get()).toHaveLength(1);
    await s.set([]);
    expect(text.m.has("h")).toBe(false);
    expect(historySig([])).toBe("0:0:0");
  });
});
