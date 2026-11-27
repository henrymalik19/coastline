import { describe, expect, it } from "vitest";
import { accountForecasts, derive, simulatePlan, type PlanState } from "../src";
import { sampleState, START } from "./fixtures";

/** A card you pay in full: what you owe is covered by money set aside for it on Budget. */
const withCard = (covered?: number): PlanState => {
  const s = sampleState();
  s.accounts = [...s.accounts.filter((a) => a.type !== "cash"), { id: "chk", name: "Checking", type: "cash", balance: 5000 }];
  s.debts = [{ id: "card", name: "Visa", kind: "credit_card", balance: 1200, apr: 0.24, minPayment: 0 }];
  if (covered !== undefined) s.cardsCovered = { card: covered };
  return s;
};

describe("a card covered by money set aside for it", () => {
  it("starts owing only what isn't covered, with that much less cash, so it isn't paid twice", () => {
    const plain = withCard();
    const full = withCard(1200);
    const p0 = simulatePlan(plain, derive(plain, START)).months[0]!;
    const p1 = simulatePlan(full, derive(full, START)).months[0]!;
    expect(p1.debts.find((x) => x.id === "card")!.balance).toBe(0);
    // the same money either way: before, the plan paid the card from what's left; now it's already paid
    expect(p1.alloc.debt).toBeLessThan(p0.alloc.debt + 1e-9);
    // more than you owe counts only up to what you owe
    const over = withCard(5000);
    expect(simulatePlan(over, derive(over, START)).months[0]!.cash).toBeCloseTo(p1.cash, 6);
  });
  it("the forecast table leaves out a fully covered card and shows the rest of a partly covered one", () => {
    const full = withCard(1200);
    const d = derive(full, START);
    expect(accountForecasts(full, d, simulatePlan(full, d), d.r).some((a) => a.key === "debt:card")).toBe(false);
    const part = withCard(200);
    const dp = derive(part, START);
    const card = accountForecasts(part, dp, simulatePlan(part, dp), dp.r).find((a) => a.key === "debt:card")!;
    expect(card.start).toBeCloseTo(1000, 6);
    const cash = accountForecasts(part, dp, simulatePlan(part, dp), dp.r).find((a) => a.key === "cash")!;
    expect(cash.start).toBeCloseTo(dp.bal.cash - 200, 6);
  });
});
