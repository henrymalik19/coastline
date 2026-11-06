import type { PlanState } from "@coastfi/engine";
import { defaultPlanState } from "@coastfi/schema";
import { newId } from "./id";

/** Budget groups and items offered during setup (amounts start at 0; nothing is assumed). */
export const BUDGET_PRESETS: { group: string; name: string; inRetirement: boolean }[] = [
  { group: "Housing", name: "Rent / mortgage", inRetirement: true },
  { group: "Housing", name: "Utilities", inRetirement: true },
  { group: "Housing", name: "Home / renter's insurance", inRetirement: true },
  { group: "Food", name: "Groceries", inRetirement: true },
  { group: "Food", name: "Dining out", inRetirement: true },
  { group: "Transportation", name: "Gas & transit", inRetirement: true },
  { group: "Transportation", name: "Car insurance", inRetirement: true },
  { group: "Bills", name: "Phone & internet", inRetirement: true },
  { group: "Bills", name: "Subscriptions", inRetirement: true },
  { group: "Personal", name: "Fun & hobbies", inRetirement: true },
  { group: "Personal", name: "Clothing & personal care", inRetirement: true },
  { group: "Family", name: "Childcare", inRetirement: false },
];

/** Common employer match formulas, as tier settings. */
export const MATCH_PRESETS = [
  { label: "100% of 3% + 50% of next 2%", r1: 1, u1: 0.03, r2: 0.5, u2: 0.02 },
  { label: "50% of first 6%", r1: 0.5, u1: 0.06, r2: 0, u2: 0 },
  { label: "100% of first 4%", r1: 1, u1: 0.04, r2: 0, u2: 0 },
  { label: "100% of first 6%", r1: 1, u1: 0.06, r2: 0, u2: 0 },
  { label: "No match", r1: 0, u1: 0, r2: 0, u2: 0 },
] as const;

/** A blank plan with the setup scaffolding (one income, preset budget lines, the standard accounts). */
export function freshPlan(): PlanState {
  const p = defaultPlanState();
  p.incomes = [
    { id: newId(), name: "Main job", kind: "job", freq: "biweekly", net: 0, netMode: "auto", matchMode: "pct", gross: 0, contribPct: 0.04, matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02, taxes: { federal: 0, state: 0, socialSecurity: 0, medicare: 0 }, deductions: [] },
  ];
  p.budget = BUDGET_PRESETS.map((b) => ({ id: newId(), name: b.name, group: b.group, amount: 0, inRetirement: b.inRetirement }));
  p.accounts = [
    { id: newId(), name: "401(k) / traditional IRA", type: "pretax", balance: 0 },
    { id: newId(), name: "Roth IRA", type: "roth", balance: 0 },
    { id: newId(), name: "Brokerage", type: "taxable", balance: 0 },
    { id: newId(), name: "Savings / checking", type: "cash", balance: 0 },
  ];
  return p;
}
