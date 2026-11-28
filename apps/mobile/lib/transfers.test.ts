import { startTxnId, transferPair, type Txn } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { BANK_ID, mergeBankTxns, type BankTxn } from "./bankTxns";
import { freshPlan } from "./presets";
import { repairTransfers } from "./transfers";

const tx = (o: Partial<Txn> & Pick<Txn, "id" | "accountId" | "amount">): Txn => ({ date: "2026-11-23", cleared: "cleared", source: "manual", updatedAt: 1, ...o });
const live = (txns: Txn[]) => txns.filter((t) => !t.deleted);

describe("a bank transaction made into a transfer", () => {
  const plan = freshPlan();
  plan.accounts = [
    { id: "chk", name: "Checking", type: "cash", balance: 1000, plaidAccountId: "pa1" },
    { id: "bill", name: "Bill Pay", type: "cash", balance: 0 },
  ];
  const start = tx({ id: startTxnId("chk"), accountId: "chk", amount: 1000, date: "2026-11-01" });
  const row: BankTxn = { transactionId: "b1", accountId: "pa1", date: "2026-11-23", amount: 4940.39, name: "TRANSFER", merchantName: null, pending: false };
  const fromBank = tx({ id: BANK_ID + "b1", accountId: "chk", amount: -4940.39, source: "plaid", importId: "b1", transferAccountId: "bill", transferId: BANK_ID + "b1:t" });

  it("its other side isn't the bank's (a sync leaves it alone)", () => {
    const pair = transferPair(fromBank)!;
    expect([pair.amount, pair.source, pair.importId, pair.accountId]).toEqual([4940.39, "manual", undefined, "bill"]);
    const r = mergeBankTxns([start, fromBank, pair], plan, [row], 9);
    expect(live(r.txns).map((t) => [t.id, t.amount]).sort()).toEqual([[BANK_ID + "b1", -4940.39], [BANK_ID + "b1:t", 4940.39], [startTxnId("chk"), 1000]].sort());
  });

  it("one no longer marked as the bank's, sent again by the bank, is updated, not removed", () => {
    const notBank = { ...fromBank, source: "manual" as const, importId: undefined };
    const r = mergeBankTxns([start, notBank, transferPair(notBank)!], plan, [row], 9);
    const mine = r.txns.find((t) => t.id === BANK_ID + "b1")!;
    expect([mine.deleted, mine.source, mine.transferAccountId]).toEqual([undefined, "plaid", "bill"]);
  });

  it("a transfer missing its other side gets it back; a matching one already there is linked instead", () => {
    const ids = new Set(["chk", "bill"]);
    const lost = { ...transferPair(fromBank)!, amount: -4940.39, source: "plaid" as const, importId: "b1", deleted: true };
    const r = repairTransfers([start, fromBank, lost], ids, 9);
    const back = r.txns.find((t) => t.id === BANK_ID + "b1:t")!;
    expect([back.deleted, back.amount, back.source, back.importId]).toEqual([false, 4940.39, "manual", undefined]);
    // a side already in Bill Pay (typed in), not paired with anything: linked
    const typed = tx({ id: "typed", accountId: "bill", amount: 4940.39, date: "2026-11-24", transferAccountId: "chk" });
    const r2 = repairTransfers([start, fromBank, lost, typed], ids, 9);
    expect(r2.txns.find((t) => t.id === BANK_ID + "b1")!.transferId).toBe("typed");
    expect(r2.txns.find((t) => t.id === "typed")!.transferId).toBe(BANK_ID + "b1");
    expect(r2.txns.find((t) => t.id === BANK_ID + "b1:t")!.deleted).toBe(true);
    // a healthy pair: nothing changes
    expect(repairTransfers([start, fromBank, transferPair(fromBank)!], ids, 9).fixed).toBe(0);
  });
});
