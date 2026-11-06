import type { PlanState } from "@coastfi/engine";
import { defaultPlanState } from "@coastfi/schema";
import { newId } from "./store";

/** Budget categories offered during setup (amounts start at 0; nothing is assumed). */
export const BUDGET_PRESETS: { name: string; inRetirement: boolean }[] = [
  { name: "Rent / mortgage", inRetirement: true },
  { name: "Groceries", inRetirement: true },
  { name: "Transportation", inRetirement: true },
  { name: "Utilities & phone", inRetirement: true },
  { name: "Insurance", inRetirement: true },
  { name: "Fun & dining", inRetirement: true },
  { name: "Subscriptions", inRetirement: true },
  { name: "Childcare", inRetirement: false },
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
    { id: newId(), name: "Main job", freq: "biweekly", net: 0, matchMode: "pct", gross: 0, contribPct: 0.04, matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02 },
  ];
  p.budget = BUDGET_PRESETS.map((b) => ({ id: newId(), name: b.name, amount: 0, inRetirement: b.inRetirement }));
  p.accounts = [
    { id: newId(), name: "401(k) / traditional IRA", type: "pretax", balance: 0 },
    { id: newId(), name: "Roth IRA", type: "roth", balance: 0 },
    { id: newId(), name: "Brokerage", type: "taxable", balance: 0 },
    { id: newId(), name: "Savings / checking", type: "cash", balance: 0 },
  ];
  return p;
}
