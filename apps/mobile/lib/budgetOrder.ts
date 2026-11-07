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

/**
 * Move the entry with `id` one place up/down among only the entries `shown` picks (e.g. the debts
 * the budget lists), swapping it with its visible neighbour. Others keep their places.
 */
export function moveAmong<T extends { id: string }>(list: T[], id: string, by: -1 | 1, shown: (x: T) => boolean): T[] {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return list;
  let j = i + by;
  while (j >= 0 && j < list.length && !shown(list[j]!)) j += by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Move an item into another group (it goes to the end of that group; a new group goes last). */
export function moveToGroup(items: BudgetItem[], index: number, group: string): BudgetItem[] {
  const item = items[index];
  const name = group.trim();
  if (!item || !name || groupOf(item) === name) return items;
  const rest = items.filter((_, i) => i !== index);
  const moved = { ...item, group: name };
  const last = rest.map((b, i) => (groupOf(b) === name ? i : -1)).filter((i) => i >= 0).at(-1);
  if (last === undefined) return [...rest, moved];
  return [...rest.slice(0, last + 1), moved, ...rest.slice(last + 1)];
}

/** Merge one group into another: its items join the end of the other group, in their order. */
export function mergeGroup(items: BudgetItem[], from: string, into: string): BudgetItem[] {
  if (from === into) return items;
  const moving = items.filter((b) => groupOf(b) === from).map((b) => ({ ...b, group: into }));
  if (!moving.length) return items;
  const rest = items.filter((b) => groupOf(b) !== from);
  const last = rest.map((b, i) => (groupOf(b) === into ? i : -1)).filter((i) => i >= 0).at(-1);
  if (last === undefined) return [...rest, ...moving];
  return [...rest.slice(0, last + 1), ...moving, ...rest.slice(last + 1)];
}
