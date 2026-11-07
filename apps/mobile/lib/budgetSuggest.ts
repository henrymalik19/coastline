import type { BudgetItem, Goal } from "@coastfi/engine";
import { newId } from "./id";

/**
 * Budget hints from item names: "this is something you save up for" (make it a goal).
 * Built-in word lists only (instant, private). Nothing changes until the user taps.
 */


/** Things people save up for. `recurring` ones come around again (yearly by default). */
const GOAL_RULES: { words: string[]; recurring: boolean; december?: boolean }[] = [
  { words: ["birthday"], recurring: true },
  { words: ["christmas", "holiday", "gift"], recurring: true, december: true },
  { words: ["vacation", "trip", "travel", "property tax", "registration", "annual", "yearly", "sinking"], recurring: true },
  { words: ["wedding", "down payment", "house fund", "new car", "car fund", "savings", "save for", "fund"], recurring: false },
];

/** Whole-word match (a trailing "s" allowed): "fund" matches "Car fund", not "Funding". */
const has = (name: string, word: string) =>
  new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?![a-z])`).test(name.toLowerCase());

export type Suggestion =
  | { kind: "group"; item: BudgetItem; group: string }
  | { kind: "goal"; item: BudgetItem; recurring: boolean; december: boolean };

export function suggestFor(item: BudgetItem): Suggestion | null {
  if (item.noSuggest || !item.name.trim()) return null;
  const n = item.name;
  // emergency funds are handled by the plan itself, not a goal
  if (!/emergency/i.test(n)) {
    const g = GOAL_RULES.find((r) => r.words.some((w) => has(n, w)));
    if (g) return { kind: "goal", item, recurring: g.recurring, december: !!g.december };
  }
  // group suggestions were dropped: they scattered items into lots of tiny groups.
  // Moving items and merging groups is up to you (Budget → edit an item / rename a group).
  return null;
}

/** "YYYY-MM" for the next December, or 12 months from `today` (a UI default only). */
function nextDue(today: Date, december: boolean): string {
  const y = today.getFullYear();
  if (december) return `${today.getMonth() === 11 ? y + 1 : y}-12`;
  const d = new Date(y, today.getMonth() + 11, 1); // 12 equal set-asides, counting this month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The goal a budget item becomes: what it costs over a year, recurring yearly when it comes around again. */
export function goalFromItem(item: BudgetItem, recurring: boolean, december: boolean, today = new Date()): Goal {
  return {
    id: newId(),
    name: item.name.trim(),
    target: Math.round(item.amount * 12 * 100) / 100,
    saved: 0,
    ...(recurring ? { recurring: { every: 12, due: nextDue(today, december), ...(item.inRetirement ? null : { inRetirement: false }) } } : null),
  };
}
