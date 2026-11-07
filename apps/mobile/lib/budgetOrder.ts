import type { BudgetItem } from "@coastfi/engine";

/** Budget items without a group show under "Other". */
export const UNGROUPED = "Other";
export const groupOf = (b: BudgetItem) => b.group?.trim() || UNGROUPED;

/** Group names in the order they first appear. */
export function groupOrder(items: BudgetItem[]): string[] {
  const out: string[] = [];
  for (const b of items) if (!out.includes(groupOf(b))) out.push(groupOf(b));
  return out;
}

/** Move a whole group one place earlier (-1) or later (+1). Items keep their order inside groups. */
export function moveGroup(items: BudgetItem[], group: string, by: -1 | 1): BudgetItem[] {
  const order = groupOrder(items);
  const i = order.indexOf(group);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return items;
  [order[i], order[j]] = [order[j]!, order[i]!];
  return order.flatMap((g) => items.filter((b) => groupOf(b) === g));
}

/** Move an item one place up (-1) or down (+1) within its own group. */
export function moveItem(items: BudgetItem[], index: number, by: -1 | 1): BudgetItem[] {
  const item = items[index];
  if (!item) return items;
  const g = groupOf(item);
  let j = index + by;
  while (j >= 0 && j < items.length && groupOf(items[j]!) !== g) j += by;
  if (j < 0 || j >= items.length) return items;
  const out = [...items];
  [out[index], out[j]] = [out[j]!, out[index]!];
  return out;
}
