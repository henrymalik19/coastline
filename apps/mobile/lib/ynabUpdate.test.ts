import type { PlanState, Txn } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { freshPlan } from "./presets";
import { buildImport, parseYnab } from "./ynab";
import { applyYnabUpdate, planYnabUpdate, snapshotUpdate, undoYnabUpdate } from "./ynabUpdate";

const HEAD = `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"\n`;
const row = (date: string, payee: string, group: string, cat: string, out: string, inflow = "$0.00") =>
  `"Checking","","${date}","${payee}","${group}: ${cat}","${group}","${cat}","","${out}","${inflow}","Cleared"\n`;
const PAY = row("11/01/2026", "Employer", "Inflow", "Ready to Assign", "$0.00", "$4,000.00");
const KROGER = row("11/02/2026", "Kroger", "Everyday", "Groceries", "$120.00");
// the first export, then a newer one: Shell's amount changed in YNAB, and two new ones (one in a category you don't have)
const V1 = HEAD + row("11/03/2026", "Shell", "Car", "Gas", "$40.00") + KROGER + PAY;
const V2 = HEAD + row("11/12/2026", "Etsy", "Fun", "Gifts", "$25.00") + row("11/10/2026", "Costco", "Everyday", "Groceries", "$80.00") + row("11/03/2026", "Shell", "Car", "Gas", "$45.00") + KROGER + PAY;

function imported() {
  const plan: PlanState = freshPlan();
  plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 0 }];
  plan.budget = [
    { id: "food", name: "Groceries", amount: 600, inRetirement: true, group: "Everyday" },
    { id: "gas", name: "Gas", amount: 100, inRetirement: true, group: "Car" },
  ];
  let n = 0;
  const newId = () => `n${++n}`;
  const r = buildImport(plan, parseYnab(V1), { from: "2026-11", thisMonth: "2026-11", accounts: { Checking: { action: "match", id: "chk" } }, categories: {}, removeEmpty: false, newId });
  const txns = r.txns.map((t) => ({ ...t, updatedAt: 100 }));
  return { plan: r.plan, txns, newId };
}
const mine: Txn = { id: "m1", accountId: "chk", date: "2026-11-10", amount: -80, payee: "Costco", cleared: "uncleared", source: "manual", updatedAt: 150 };

describe("update transactions from YNAB", () => {
  it("brings in what's new or changed, finds what's gone, and leaves categories and amounts alone", () => {
    const { plan, txns, newId } = imported();
    const u = planYnabUpdate(plan, parseYnab(V2), [...txns, mine], 100, "2026-11", newId);
    expect(u.add.map((t) => [t.payee, t.amount]).sort()).toEqual([["Costco", -80], ["Etsy", -25]]);
    // Shell's amount changed in YNAB (a tip): the same transaction, updated in place
    const shell = txns.find((t) => t.payee === "Shell")!;
    expect(u.changed.map((t) => [t.id, t.amount])).toEqual([[shell.id, -45]]);
    expect(u.gone).toEqual([]);
    expect(u.keptEdited).toEqual([]);
    expect(u.replaced).toEqual(["m1"]); // yours, the same as YNAB's new Costco
    expect(u.hiddenAdded.map((b) => [b.name, b.hidden])).toEqual([["Gifts", true]]);
    expect(u.add.find((t) => t.payee === "Etsy")!.categoryId).toBe(u.hiddenAdded[0]!.id);
    expect(u.add.find((t) => t.payee === "Costco")!.categoryId).toBe("food");
    expect(u.skippedAccounts).toEqual([]);
  });

  it("changed in both apps: yours stays, once, and isn't changed again by the same export", () => {
    const { plan, txns, newId } = imported();
    const edited = txns.map((t) => (t.payee === "Shell" ? { ...t, memo: "road trip", updatedAt: 200 } : t));
    const u = planYnabUpdate(plan, parseYnab(V2), edited, 100, "2026-11", newId);
    expect([u.gone, u.keptEdited, u.changed]).toEqual([[], [], []]);
    expect(u.changedBoth.map((t) => [t.memo, t.amount])).toEqual([["road trip", -40]]);
    const out = applyYnabUpdate(edited, u, 100, true, 300);
    expect(out.filter((t) => !t.deleted && t.payee === "Shell").map((t) => [t.memo, t.source])).toEqual([["road trip", "ynab"]]);
    const again = planYnabUpdate(plan, parseYnab(V2), out, 300, "2026-11", newId);
    expect([again.add.length, again.changed.length, again.changedBoth.length, again.gone.length]).toEqual([0, 0, 0, 0]);
  });

  it("gone from YNAB but changed here: yours stays and becomes yours", () => {
    const { plan, txns, newId } = imported();
    const edited = txns.map((t) => (t.payee === "Kroger" ? { ...t, memo: "party", updatedAt: 200 } : t));
    const u = planYnabUpdate(plan, parseYnab(V2.replace(KROGER, "")), edited, 100, "2026-11", newId);
    expect(u.keptEdited.map((t) => t.memo)).toEqual(["party"]);
    const out = applyYnabUpdate(edited, u, 100, true, 300);
    expect(out.find((t) => t.memo === "party")).toMatchObject({ source: "manual", updatedAt: 300 });
  });

  it("a category changed in YNAB updates the one here, keeping its id", () => {
    const { plan, txns, newId } = imported();
    const kroger = txns.find((t) => t.payee === "Kroger")!;
    const V3 = V1.replace(KROGER, row("11/02/2026", "Kroger", "Car", "Gas", "$120.00"));
    const u = planYnabUpdate(plan, parseYnab(V3), txns, 100, "2026-11", newId);
    expect([u.add.length, u.gone.length]).toEqual([0, 0]);
    expect(u.changed.map((t) => [t.id, t.categoryId])).toEqual([[kroger.id, "gas"]]);
    const out = applyYnabUpdate(txns, u, 100, true, 300);
    expect(out.filter((t) => !t.deleted && t.payee === "Kroger").map((t) => [t.id, t.categoryId])).toEqual([[kroger.id, "gas"]]);
    // the same export again: it knows it now
    const again = planYnabUpdate(plan, parseYnab(V3), out, 300, "2026-11", newId);
    expect([again.add.length, again.changed.length, again.gone.length]).toEqual([0, 0, 0]);
  });

  it("one you left without a category here takes YNAB's, even if you changed something else", () => {
    const { plan, txns, newId } = imported();
    const edited = txns.map((t) => (t.payee === "Kroger" ? { ...t, categoryId: undefined, cleared: "reconciled" as const, updatedAt: 200 } : t));
    const V3 = V1.replace(KROGER, row("11/02/2026", "Kroger", "Car", "Gas", "$120.00"));
    const u = planYnabUpdate(plan, parseYnab(V3), edited, 100, "2026-11", newId);
    expect(u.changedBoth.map((t) => [t.categoryId, t.cleared])).toEqual([["gas", "reconciled"]]);
  });

  it("two the same day at the same place: an amount change only matches when it's clear which", async () => {
    const { pairChanged } = await import("./ynabUpdate");
    const t = (id: string, amount: number): Txn => ({ id, accountId: "chk", date: "2026-11-02", amount, payee: "Cafe", cleared: "cleared", source: "ynab", updatedAt: 1 });
    expect(pairChanged([t("a", -5)], [t("b", -6)]).map(([x, y]) => [x.id, y.id])).toEqual([["a", "b"]]);
    expect(pairChanged([t("a", -5), t("c", -9)], [t("b", -6), t("d", -10)])).toEqual([]);
    expect(pairChanged([t("a", -5), t("c", -9)], [t("b", -5), t("d", -10)]).map(([x, y]) => [x.id, y.id])).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("applies it: new ones in, gone ones out only if you say so", () => {
    const { plan, txns, newId } = imported();
    const u = planYnabUpdate(plan, parseYnab(V2), [...txns, mine], 100, "2026-11", newId);
    const out = applyYnabUpdate([...txns, mine], u, 100, true, 300);
    const live = out.filter((t) => !t.deleted && !t.id.startsWith("start:"));
    expect(live.map((t) => [t.payee, t.amount]).sort()).toEqual([["Costco", -80], ["Employer", 4000], ["Etsy", -25], ["Kroger", -120], ["Shell", -45]]);
    expect(out.find((t) => t.id === "m1")).toMatchObject({ deleted: true, updatedAt: 300 });
    const keep = applyYnabUpdate([...txns, mine], u, 100, false, 300);
    expect(keep.filter((t) => !t.deleted && t.payee === "Shell").map((t) => t.amount)).toEqual([-45]);
    // the same export again: nothing new
    const again = planYnabUpdate(plan, parseYnab(V2), out, 300, "2026-11", newId);
    expect([again.add.length, again.changed.length, again.gone.length, again.replaced.length]).toEqual([0, 0, 0, 0]);
  });

  it("keeps each account where the import put it, even when an old YNAB account has your account's name", () => {
    // yours is "Checking"; at import you put YNAB's "Joint" into it. YNAB also has an old, closed "Checking"
    const acct = (name: string, r: string) => r.replace('"Checking"', `"${name}"`);
    const OLD = acct("Checking", row("01/06/2019", "Bank", "Everyday", "Groceries", "$10.00")) + acct("Checking", row("02/06/2019", "Bank", "Inflow", "Ready to Assign", "$0.00", "$10.00"));
    const JOINT = acct("Joint", KROGER) + acct("Joint", PAY);
    const plan: PlanState = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 0 }];
    plan.budget = [{ id: "food", name: "Groceries", amount: 600, inRetirement: true, group: "Everyday" }];
    let k = 0;
    const newId = () => `n${++k}`;
    const r = buildImport(plan, parseYnab(HEAD + JOINT + OLD), { from: "2026-11", thisMonth: "2026-11", accounts: { Joint: { action: "match", id: "chk" }, Checking: { action: "skip" } }, categories: {}, removeEmpty: false, newId });
    const txns = r.txns.map((t) => ({ ...t, updatedAt: 100 }));
    const u = planYnabUpdate(r.plan, parseYnab(HEAD + acct("Joint", row("11/05/2026", "Shell", "Car", "Gas", "$30.00")) + JOINT + OLD), txns, 100, "2026-11", newId);
    expect(u.gone).toEqual([]);
    expect(u.add.map((t) => [t.accountId, t.payee])).toEqual([["chk", "Shell"]]);
    expect(u.skippedAccounts).toEqual(["Checking"]);
  });

  it("skips accounts you don't have here", () => {
    const { plan, txns, newId } = imported();
    const u = planYnabUpdate(plan, parseYnab(V2.replace(`"Checking","","11/12/2026"`, `"Savings","","11/12/2026"`)), txns, 100, "2026-11", newId);
    expect(u.skippedAccounts).toEqual(["Savings"]);
    expect(u.add.some((t) => t.payee === "Etsy")).toBe(false);
  });

  it("warns when one account would lose many or get older ones (the wrong YNAB account)", () => {
    const acct = (name: string, r: string) => r.replace('"Checking"', `"${name}"`);
    const plan: PlanState = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 0 }];
    plan.budget = [{ id: "food", name: "Groceries", amount: 600, inRetirement: true, group: "Everyday" }];
    const days = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
    const NOW = days.map((d) => row(`11/${d}/2026`, "Kroger", "Everyday", "Groceries", "$10.00")).join("");
    const OLD = days.map((d) => acct("Old", row(`03/${d}/2019`, "Bank", "Everyday", "Groceries", "$5.00"))).join("");
    let k = 0;
    const newId = () => `n${++k}`;
    const r = buildImport(plan, parseYnab(HEAD + NOW), { from: "2026-11", thisMonth: "2026-11", accounts: { Checking: { action: "match", id: "chk" } }, categories: {}, removeEmpty: false, newId });
    const txns = r.txns.map((t) => ({ ...t, updatedAt: 100 }));
    // the newer export has the current account renamed, and an old one with your account's name
    const u = planYnabUpdate(r.plan, parseYnab(HEAD + NOW.replace(/"Checking"/g, '"Other"') + OLD.replace(/"Old"/g, '"Checking"')), txns, 100, "2026-11", newId);
    expect(u.warnings).toEqual([{ accountId: "chk", ynab: "Checking", gone: 12, older: 0 }]); // (2019 is before the months this update looks at)
    const fine = planYnabUpdate(r.plan, parseYnab(HEAD + NOW), txns, 100, "2026-11", newId);
    expect(fine.warnings).toEqual([]);
  });

  it("an update can be undone: changed ones back as they were, new ones deleted", () => {
    const { plan, txns, newId } = imported();
    const u = planYnabUpdate(plan, parseYnab(V2), [...txns, mine], 100, "2026-11", newId);
    const before = [...txns, mine];
    const after = applyYnabUpdate(before, u, 100, true, 300);
    const snap = snapshotUpdate(before, after, 300, 100);
    const back = undoYnabUpdate(after, snap, 400);
    const live = (l: Txn[]) => l.filter((t) => !t.deleted).map((t) => [t.payee, t.amount, t.categoryId]).sort();
    expect(live(back)).toEqual(live(before));
    expect(back.filter((t) => snap.added.includes(t.id)).every((t) => t.deleted && t.updatedAt === 400)).toBe(true);
  });
});
