/**
 * A transfer to an account that isn't in Coastwise (an old or closed one you left out of an import).
 * It's still a transfer, not spending, so it needs no category. Its `transferAccountId` is this prefix
 * plus that account's name, since there's no account here to point at.
 */
export const OUTSIDE = "outside:";

export const isOutside = (id?: string): boolean => !!id && id.startsWith(OUTSIDE);

/** "Old Savings (not in Coastwise)" for an outside account, else undefined. */
export const outsideName = (id?: string): string | undefined => (isOutside(id) ? `${id!.slice(OUTSIDE.length) || "Another account"} (not in Coastwise)` : undefined);
