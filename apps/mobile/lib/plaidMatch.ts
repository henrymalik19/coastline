/**
 * Bank accounts (from Plaid) and your plan: which plan account or debt each one can match, what a new
 * one would be, and copying the bank's balances into the ones you've matched. No store, no network.
 */
import type { Account, Debt, PlanState } from "@coastfi/engine";

/** One account at a connected bank (a plaid_accounts row). Amounts as the bank gives them. */
export type BankAccount = {
  id: string;
  item: string;
  accountId: string;
  name: string;
  officialName?: string | null;
  mask?: string | null;
  /** depository, credit, loan, investment, other */
  type: string;
  subtype?: string | null;
  current?: number | null;
  available?: number | null;
  creditLimit?: number | null;
  /** Cards and loans, when the bank shares them: yearly rate (0.2399) and minimum payment. */
  apr?: number | null;
  minPayment?: number | null;
  updatedAt?: string;
};

/** Cards and loans match a debt; everything else matches an account. */
export const isDebtLike = (b: Pick<BankAccount, "type">) => b.type === "credit" || b.type === "loan";

const cents = (v: number) => Math.round(v * 100) / 100;

/** "Plaid Checking ••0000" */
export const bankLabel = (b: Pick<BankAccount, "name" | "officialName" | "mask">) => `${b.name || b.officialName || "Account"}${b.mask ? ` ••${b.mask}` : ""}`;

/** The plan account or debt a bank account is matched to, if any. */
export function matchOf(p: Pick<PlanState, "accounts" | "debts">, b: Pick<BankAccount, "accountId">): { kind: "account"; item: Account } | { kind: "debt"; item: Debt } | null {
  const a = p.accounts.find((x) => x.plaidAccountId === b.accountId);
  if (a) return { kind: "account", item: a };
  const d = p.debts.find((x) => x.plaidAccountId === b.accountId);
  return d ? { kind: "debt", item: d } : null;
}

/** What a bank account would be if added to the plan (type, name, debt kind). `company`: the bank's name. */
export function newFromBank(b: BankAccount, id: string, company?: string): { kind: "account"; account: Account } | { kind: "debt"; debt: Debt } {
  const name = b.name || b.officialName || "Account";
  const co = company?.trim() ? { company: company.trim() } : {};
  const bal = Math.max(0, cents(b.current ?? 0));
  if (isDebtLike(b)) {
    const st = (b.subtype ?? "").toLowerCase();
    const kind: Debt["kind"] = b.type === "credit" ? "credit_card" : st === "student" ? "student" : st === "mortgage" ? "mortgage" : st === "auto" ? "car" : "personal";
    return { kind: "debt", debt: { id, name, ...co, kind, balance: bal, apr: b.apr ?? 0, minPayment: cents(b.minPayment ?? 0), plaidAccountId: b.accountId } };
  }
  const st = (b.subtype ?? "").toLowerCase();
  const base = { id, name, ...co, balance: bal, plaidAccountId: b.accountId };
  if (b.type === "depository") return { kind: "account", account: { ...base, type: "cash" } };
  if (b.type === "investment") {
    if (/hsa/.test(st)) return { kind: "account", account: { ...base, type: "hsa" } };
    if (/roth/.test(st)) return { kind: "account", account: { ...base, type: "roth", counts: /401|403|457/.test(st) ? "k401" : "ira" } };
    if (/401|403|457|thrift|tsp|profit sharing|pension|retirement/.test(st)) return { kind: "account", account: { ...base, type: "pretax", counts: "k401" } };
    if (/ira|sep|sarsep|keogh/.test(st)) return { kind: "account", account: { ...base, type: "pretax", counts: "ira" } };
    return { kind: "account", account: { ...base, type: "taxable" } };
  }
  return { kind: "account", account: { ...base, type: "taxable", counts: "other" } };
}

/** Match a bank account to a plan account or debt (or to nothing): one bank account, one match. */
export function setMatch(p: PlanState, b: Pick<BankAccount, "accountId">, to: { kind: "account" | "debt"; id: string } | null): void {
  for (const a of p.accounts) if (a.plaidAccountId === b.accountId) delete a.plaidAccountId;
  for (const d of p.debts) if (d.plaidAccountId === b.accountId) delete d.plaidAccountId;
  if (!to) return;
  const x = to.kind === "account" ? p.accounts.find((a) => a.id === to.id) : p.debts.find((d) => d.id === to.id);
  if (x) x.plaidAccountId = b.accountId;
}

/**
 * Copy the bank's balances into the matched accounts and debts. Not into one that keeps a register in
 * Budget (its balance comes from its transactions there). A debt's rate and minimum fill in only when
 * you haven't set them. Returns whether anything changed.
 */
export function applyBankBalances(p: PlanState, bank: BankAccount[], hasRegister: (planAccountId: string) => boolean): boolean {
  const by = new Map(bank.map((b) => [b.accountId, b]));
  let changed = false;
  for (const a of p.accounts) {
    const b = a.plaidAccountId ? by.get(a.plaidAccountId) : undefined;
    if (!b || b.current == null || hasRegister(a.id)) continue;
    const v = Math.max(0, cents(b.current));
    if (Math.abs(a.balance - v) > 0.004) {
      a.balance = v;
      changed = true;
    }
  }
  for (const d of p.debts) {
    const b = d.plaidAccountId ? by.get(d.plaidAccountId) : undefined;
    if (!b) continue;
    if (b.current != null && !hasRegister(d.id)) {
      const v = Math.max(0, cents(b.current));
      if (Math.abs(d.balance - v) > 0.004) {
        d.balance = v;
        changed = true;
      }
    }
    if (!d.apr && b.apr != null && b.apr > 0) {
      d.apr = b.apr;
      changed = true;
    }
    if (!d.minPayment && b.minPayment != null && b.minPayment > 0) {
      d.minPayment = cents(b.minPayment);
      changed = true;
    }
  }
  return changed;
}

/** Remove the matches to bank accounts that are gone (a disconnected bank). */
export function dropMatches(p: PlanState, accountIds: string[]): boolean {
  const gone = new Set(accountIds);
  let changed = false;
  for (const x of [...p.accounts, ...p.debts]) {
    if (x.plaidAccountId && gone.has(x.plaidAccountId)) {
      delete x.plaidAccountId;
      changed = true;
    }
  }
  return changed;
}
