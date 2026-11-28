import type { BudgetItem } from "@coastfi/engine";

/** Budget items without a group show under "Other". */
export const UNGROUPED = "Other";
export const groupOf = (b: BudgetItem) => b.group?.trim() || UNGROUPED;

/** Where a repeating bill / a debt payment is listed in the budget unless you pick a group. */
export const BILLS_GROUP = "Bills";
export const DEBTS_GROUP = "Debt payments";
/** Hidden payment lines of accounts you've closed (YNAB keeps one per old card): listed apart from hidden categories. */
export const CLOSED_ACCOUNTS_GROUP = "Closed accounts";

/** The groups a bill or debt payment can be listed under: its default, then your groups (and its current one). */
export function linkedGroupChoices(items: BudgetItem[], fallback: string, current?: string): string[] {
  const out = [fallback, ...groupOrder(items)];
  if (current?.trim()) out.push(current.trim());
  return [...new Set(out)];
}

/** Your groups in order, empty ones included: the saved list, then any group a category names that isn't in it. */
export function ownGroups(p: { budget: BudgetItem[]; budgetGroups?: string[] }): string[] {
  return [...new Set([...(p.budgetGroups ?? []).map((g) => g.trim()).filter(Boolean), ...groupOrder(p.budget)])];
}
/** A group renamed: the saved list follows (merging into one already there). */
export function renameInGroups(p: { budgetGroups?: string[] }, from: string, to: string) {
  if (p.budgetGroups) p.budgetGroups = [...new Set(p.budgetGroups.map((g) => (g === from ? to : g)))];
}
/** A group deleted (or combined into another): off the saved list. */
export function removeFromGroups(p: { budgetGroups?: string[] }, name: string) {
  if (p.budgetGroups) p.budgetGroups = p.budgetGroups.filter((g) => g !== name);
}
/** Move a group one place earlier (-1) or later (+1) on the saved list, skipping over `fixed` ones. */
export function moveInGroups(p: { budget: BudgetItem[]; budgetGroups?: string[] }, name: string, by: -1 | 1, fixed: ReadonlySet<string> = new Set()) {
  const all = ownGroups(p);
  const order = all.filter((g) => !fixed.has(g));
  const i = order.indexOf(name);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j]!, order[i]!];
  p.budgetGroups = [...order, ...all.filter((g) => fixed.has(g))];
  // the categories follow, so lists that read the order from them agree
  p.budget = [...p.budgetGroups.flatMap((g) => p.budget.filter((b) => !b.hidden && groupOf(b) === g)), ...p.budget.filter((b) => b.hidden)];
}

/** Group names in the order they first appear (hidden categories don't make a group). */
export function groupOrder(items: BudgetItem[]): string[] {
  const out: string[] = [];
  for (const b of items) if (!b.hidden && !out.includes(groupOf(b))) out.push(groupOf(b));
  return out;
}

/**
 * Hide a category (it goes to the end of the list, after everything shown, keeping its group name) or show
 * it again (at the end of its group, or of the list if that group is gone).
 */
export function setHidden(items: BudgetItem[], id: string, hidden: boolean): BudgetItem[] {
  const item = items.find((b) => b.id === id);
  if (!item || !!item.hidden === hidden) return items;
  const rest = items.filter((b) => b.id !== id);
  if (hidden) {
    const { accountId: _, ...plain } = item;
    return [...rest, { ...plain, hidden: true }];
  }
  const { hidden: _h, ...shown } = item;
  const g = groupOf(item);
  const last = rest.map((b, i) => (!b.hidden && groupOf(b) === g ? i : -1)).filter((i) => i >= 0).at(-1);
  const at = last !== undefined ? last + 1 : rest.findIndex((b) => b.hidden) < 0 ? rest.length : rest.findIndex((b) => b.hidden);
  return [...rest.slice(0, at), shown, ...rest.slice(at)];
}

/**
 * Move a whole group one place earlier (-1) or later (+1). Items keep their order inside groups.
 * `fixed`: groups that keep their own place (Savings, with categories dragged into it): skipped over.
 */
export function moveGroup(items: BudgetItem[], group: string, by: -1 | 1, fixed: ReadonlySet<string> = new Set()): BudgetItem[] {
  const all = groupOrder(items);
  const order = all.filter((g) => !fixed.has(g));
  const i = order.indexOf(group);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return items;
  [order[i], order[j]] = [order[j]!, order[i]!];
  return [...[...order, ...all.filter((g) => fixed.has(g))].flatMap((g) => items.filter((b) => !b.hidden && groupOf(b) === g)), ...items.filter((b) => b.hidden)];
}

/** Move an item one place up (-1) or down (+1) within its own group. */
export function moveItem(items: BudgetItem[], index: number, by: -1 | 1): BudgetItem[] {
  const item = items[index];
  if (!item) return items;
  const g = groupOf(item);
  let j = index + by;
  while (j >= 0 && j < items.length && (items[j]!.hidden || groupOf(items[j]!) !== g)) j += by;
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

/**
 * Move an item into another group: to the end of that group, or at `at` among its items (where you
 * dropped it). A new group goes last.
 */
export function moveToGroup(items: BudgetItem[], index: number, group: string, at?: number): BudgetItem[] {
  const item = items[index];
  const name = group.trim();
  if (!item || !name || groupOf(item) === name) return items;
  const rest = items.filter((_, i) => i !== index);
  const moved = { ...item, group: name };
  const slots = rest.map((b, i) => (!b.hidden && groupOf(b) === name ? i : -1)).filter((i) => i >= 0);
  if (!slots.length) {
    const firstHidden = rest.findIndex((b) => b.hidden);
    return firstHidden < 0 || item.hidden ? [...rest, moved] : [...rest.slice(0, firstHidden), moved, ...rest.slice(firstHidden)];
  }
  const pos = at !== undefined && at < slots.length ? slots[Math.max(0, at)]! : slots.at(-1)! + 1;
  return [...rest.slice(0, pos), moved, ...rest.slice(pos)];
}

/** Merge one group into another: its items join the end of the other group, in their order. */
export function mergeGroup(items: BudgetItem[], from: string, into: string): BudgetItem[] {
  if (from === into) return items;
  // hidden ones from that group just take the new group's name, staying where they are
  const renamed = items.map((b) => (b.hidden && groupOf(b) === from ? { ...b, group: into } : b));
  const moving = renamed.filter((b) => !b.hidden && groupOf(b) === from).map((b) => ({ ...b, group: into }));
  if (!moving.length) return renamed;
  const rest = renamed.filter((b) => b.hidden || groupOf(b) !== from);
  const last = rest.map((b, i) => (!b.hidden && groupOf(b) === into ? i : -1)).filter((i) => i >= 0).at(-1);
  if (last === undefined) {
    const firstHidden = rest.findIndex((b) => b.hidden);
    return firstHidden < 0 ? [...rest, ...moving] : [...rest.slice(0, firstHidden), ...moving, ...rest.slice(firstHidden)];
  }
  return [...rest.slice(0, last + 1), ...moving, ...rest.slice(last + 1)];
}
