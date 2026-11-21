/**
 * The bank connections and accounts loaded for this plan (lib/plaid.ts loads them). Apart, with nothing
 * but the store library, so the plan (lib/plan.ts) can show bank balances without importing the bank
 * code, which depends on sync (that would be an import cycle).
 */
import { create } from "zustand";
import type { BankAccount } from "./plaidMatch";

export type BankItem = {
  id: string;
  institution: string;
  kind: "bank" | "investments";
  status: "ok" | "login_required" | "pending_expiration" | "error";
  errorCode?: string | null;
  lastSyncedAt?: string | null;
};

type PlaidState = {
  planId?: string; items: BankItem[]; accounts: BankAccount[]; loaded: boolean; busy: boolean; error?: string;
  /** May this person connect new banks? Undefined until asked. */
  canLink?: boolean;
};
export const usePlaid = create<PlaidState>(() => ({ items: [], accounts: [], loaded: false, busy: false }));
