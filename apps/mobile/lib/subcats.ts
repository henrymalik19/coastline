/**
 * Sub categories: a budget category can sit under another (one level: Group → Category → Sub category).
 * Each keeps its own amount and money; the category above shows the total of its own share and its sub
 * categories (bottom-up, like a group). These helpers keep the list in order and the links valid.
 */
import type { BudgetItem } from "@coastfi/engine";
import { groupOf } from "./budgetOrder";

const active = (b: BudgetItem) => !b.hidden;

/** The sub categories of a category (shown ones, in list order). */
export const subsOf = (items: BudgetItem[], id: string) => items.filter((b) => b.parentId === id && active(b));

/** Can it sit under another? Not one with sub categories of its own, nor money moved to an account or a loan payment. */
export const canBeSub = (items: BudgetItem[], id: string) => {
  const b = items.find((x) => x.id === id);
  return !!b && !b.hidden && !b.accountId && !b.paysDebt && !items.some((x) => x.parentId === id && active(x));
};

/** The categories it could go under: shown, top-level spending ones (not itself, not linked to an account). */
export const parentChoices = (items: BudgetItem[], id: string) =>
  items.filter((b) => b.id !== id && active(b) && !b.parentId && !b.accountId);

/** Put a category under another, as a sub category: it joins that one's group, listed after its other sub categories. */
export function moveUnder(items: BudgetItem[], id: string, parentId: string): BudgetItem[] {
  const parent = items.find((b) => b.id === parentId);
  const item = items.find((b) => b.id === id);
  if (!parent || !item || parent.parentId || !canBeSub(items, id) || id === parentId) return items;
  const moved: BudgetItem = { ...item, parentId, group: parent.group };
  const rest = items.filter((b) => b.id !== id);
  const family = rest.map((b, i) => (b.id === parentId || b.parentId === parentId ? i : -1)).filter((i) => i >= 0);
  const at = (family.at(-1) ?? rest.length - 1) + 1;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** Make a sub category its own category again: after its old category's family, in the same group. */
export function makeOwn(items: BudgetItem[], id: string): BudgetItem[] {
  const item = items.find((b) => b.id === id);
  if (!item?.parentId) return items;
  const parentId = item.parentId;
  const { parentId: _, ...own } = item;
  const rest = items.filter((b) => b.id !== id);
  const family = rest.map((b, i) => (b.id === parentId || b.parentId === parentId ? i : -1)).filter((i) => i >= 0);
  const at = (family.at(-1) ?? rest.length - 1) + 1;
  return [...rest.slice(0, at), own, ...rest.slice(at)];
}

/** A category's group changed: its sub categories go with it. */
export const keepFamilyGroups = (items: BudgetItem[]): BudgetItem[] => {
  const groupById = new Map(items.map((b) => [b.id, b.group]));
  return items.map((b) => (b.parentId && groupById.has(b.parentId) && b.group !== groupById.get(b.parentId) ? { ...b, group: groupById.get(b.parentId) } : b));
};

/** What archiving a category takes with it: its shown sub categories too. */
export const archiveSet = (items: BudgetItem[], id: string) => [id, ...subsOf(items, id).map((b) => b.id)];

/**
 * Archive (history only): no monthly amount (remembered, to offer on restore), off the budget and the
 * plan, last in the list. Sub categories keep their link, so they can be restored under it.
 */
export function archive(items: BudgetItem[], ids: string[]): BudgetItem[] {
  const set = new Set(ids);
  const keep = items.filter((b) => !set.has(b.id));
  const gone = items
    .filter((b) => set.has(b.id))
    .map((b) => {
      const { accountId: _, ...plain } = b;
      return { ...plain, hidden: true, amount: 0, ...(b.amount > 0 ? { archivedAmount: b.amount } : {}) };
    });
  return [...keep, ...gone];
}

/**
 * Restore an archived category with its old amount: under its category when that one is shown, else on its
 * own in `group` (or its old group).
 */
export function restore(items: BudgetItem[], id: string, group?: string): BudgetItem[] {
  const item = items.find((b) => b.id === id);
  if (!item?.hidden) return items;
  const { hidden: _h, archivedAmount, ...rest0 } = item;
  const parent = item.parentId ? items.find((b) => b.id === item.parentId && active(b) && !b.parentId) : undefined;
  const back: BudgetItem = { ...rest0, amount: archivedAmount ?? item.amount ?? 0 };
  if (!parent) delete back.parentId;
  const others = items.filter((b) => b.id !== id);
  if (parent) return moveUnder([...others, back], id, parent.id);
  back.group = group ?? item.group;
  const g = groupOf(back);
  const last = others.map((b, i) => (active(b) && groupOf(b) === g ? i : -1)).filter((i) => i >= 0).at(-1);
  const firstHidden = others.findIndex((b) => b.hidden);
  const at = last !== undefined ? last + 1 : firstHidden < 0 ? others.length : firstHidden;
  return [...others.slice(0, at), back, ...others.slice(at)];
}
