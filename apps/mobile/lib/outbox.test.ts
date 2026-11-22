import type { Txn } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { addIds, afterUpload, changedIds, seedOutbox } from "./outbox";

const tx = (id: string, updatedAt: number): Txn => ({ id, accountId: "chk", date: "2026-11-01", amount: -5, cleared: "cleared", source: "manual", updatedAt }) as Txn;

describe("the outbox", () => {
  it("queues an edit whatever the clocks say (a partner's fast clock can't hide it)", () => {
    // the other device's rows carry times far ahead; this device's edit an earlier time
    const before = [tx("theirs", 9_000_000), tx("mine", 1)];
    const after = [before[0]!, tx("mine", 2)];
    expect(changedIds(before, after)).toEqual(["mine"]);
  });
  it("adds without duplicates, keeping order", () => {
    expect(addIds(["a", "b"], ["b", "c", "c"])).toEqual(["a", "b", "c"]);
  });
  it("a failed batch keeps its ids (only a confirmed batch clears them)", () => {
    const txns = [tx("a", 1), tx("b", 1), tx("c", 1)];
    // batch 1 (a, b) saved; batch 2 (c) failed, so afterUpload is never called for it
    expect(afterUpload(["a", "b", "c"], [txns[0]!, txns[1]!], txns)).toEqual(["c"]);
  });
  it("an edit made while its upload was on the way stays queued", () => {
    const sent = [tx("a", 1)];
    const now = [tx("a", 2)];
    expect(afterUpload(["a"], sent, now)).toEqual(["a"]);
  });
  it("a copy saved before the outbox existed is seeded from the old 'uploaded up to' time", () => {
    const txns = [tx("old", 5), tx("new", 15)];
    expect(seedOutbox(txns, 10)).toEqual(["new"]);
    // without a marker, everything (what uploading did then too)
    expect(seedOutbox(txns)).toEqual(["old", "new"]);
  });
});
