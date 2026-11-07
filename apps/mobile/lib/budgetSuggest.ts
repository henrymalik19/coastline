import type { BudgetItem, Goal } from "@coastfi/engine";
import { groupOf } from "./budgetOrder";
import { newId } from "./id";

/**
 * Budget hints from item names: a better group, or "this is something you save up for".
 * Built-in word lists only (instant, private). Nothing changes until the user taps.
 */

type GroupRule = { group: string; words: string[]; /** other groups where it also belongs */ also?: string[] };

const GROUP_RULES: GroupRule[] = [
  { group: "Housing", words: ["rent", "mortgage", "hoa", "utilities", "electric", "water bill", "sewer", "trash", "renter", "homeowner", "home insurance", "repairs", "maintenance", "lawn"] },
  { group: "Food", words: ["grocer", "dining", "restaurant", "takeout", "take-out", "doordash", "uber eats", "coffee", "starbucks", "lunch", "snacks"] },
  { group: "Transportation", words: ["gas & transit", "fuel", "gasoline", "parking", "toll", "uber", "lyft", "transit", "metro", "bus pass", "train", "car insurance", "auto insurance", "car wash", "oil change"], also: ["Car", "Auto"] },
  { group: "Bills", words: ["phone", "internet", "wifi", "wi-fi", "cable", "cell", "netflix", "spotify", "hulu", "disney", "hbo", "youtube", "apple music", "icloud", "prime", "peacock", "paramount", "patreon", "subscription"], also: ["Subscriptions", "Utilities", "Entertainment"] },
  { group: "Health", words: ["gym", "fitness", "doctor", "dentist", "pharmacy", "prescription", "medical", "therapy", "copay", "vision"], also: ["Personal", "Medical"] },
  { group: "Family", words: ["childcare", "daycare", "tuition", "school", "kids", "baby", "diapers", "allowance", "babysit"], also: ["Kids", "Children"] },
  { group: "Pets", words: ["pet", "vet", "dog", "cat food", "grooming"], also: ["Family"] },
  { group: "Giving", words: ["donation", "charity", "tithe", "church"] },
];

/** Things people save up for. `recurring` ones come around again (yearly by default). */
const GOAL_RULES: { words: string[]; recurring: boolean; december?: boolean }[] = [
  { words: ["christmas", "holiday gifts", "holidays", "gifts"], recurring: true, december: true },
  { words: ["vacation", "trip", "travel", "birthday", "property tax", "registration", "annual", "yearly", "sinking"], recurring: true },
  { words: ["wedding", "down payment", "house fund", "new car", "car fund", "savings", "save for", "fund"], recurring: false },
];

const has = (name: string, word: string) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name.toLowerCase());

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
  const rule = GROUP_RULES.find((r) => r.words.some((w) => has(n, w)));
  if (!rule) return null;
  const current = groupOf(item).toLowerCase();
  if ([rule.group, ...(rule.also ?? [])].some((x) => x.toLowerCase() === current)) return null;
  return { kind: "group", item, group: rule.group };
}

/** "YYYY-MM" for the next December, or 12 months from `today` (a UI default only). */
function nextDue(today: Date, december: boolean): string {
  const y = today.getFullYear();
  if (december) return `${today.getMonth() === 11 ? y + 1 : y}-12`;
  const d = new Date(y, today.getMonth() + 12, 1);
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
