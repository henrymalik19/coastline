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

/**
 * What a bank account can be used as: every debt for a card or loan; every account (not a property)
 * otherwise. Nothing is left out by type: people use a brokerage as their checking account, and that's
 * theirs to say. The likeliest come first: the same bank, then the same kind (cash or investments).
 */
export function matchOptions(p: Pick<PlanState, "accounts" | "debts">, b: BankAccount, company?: string): { kind: "account" | "debt"; id: string; name: string; type?: Account["type"]; likely: boolean }[] {
  // the bank's telling words ("Charles Schwab" → charles, schwab; not "bank", "credit", "union")
  const words = (company ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !["bank", "credit", "union", "financial", "federal", "national", "online"].includes(w));
  const sameBank = (x: { name?: string; company?: string }) => {
    const text = `${x.company ?? ""} ${x.name ?? ""}`.toLowerCase();
    return words.some((w) => text.includes(w));
  };
  if (isDebtLike(b))
    return p.debts
      .map((d) => ({ kind: "debt" as const, id: d.id, name: d.name || "Debt", likely: sameBank(d) }))
      .sort((x, y) => Number(y.likely) - Number(x.likely));
  const fits = (t: Account["type"]) => (bankSaysCash(b) ? t === "cash" : t !== "cash");
  const score = (a: Account) => (sameBank(a) ? 2 : 0) + (fits(a.type) ? 1 : 0);
  return p.accounts
    .filter((a) => a.type !== "property")
    .sort((x, y) => score(y) - score(x))
    .map((a) => ({ kind: "account" as const, id: a.id, name: a.name || "Account", type: a.type, likely: score(a) > 0 }));
}

/** The bank calls it a checking or savings account (cash), rather than an investment one. */
export const bankSaysCash = (b: Pick<BankAccount, "type">) => b.type === "depository";

/**
 * The bank's kind and the plan's differ (a brokerage you have as cash, a checking account you have as
 * investments). Fine if that's how you use it; the plan follows your type, never the bank's.
 */
export const kindDiffers = (a: Pick<Account, "type">, b: Pick<BankAccount, "type">) => !isDebtLike(b) && a.type !== "property" && (bankSaysCash(b) ? a.type !== "cash" : a.type === "cash");

/**
 * What a bank account would be if added to the plan (type, name, debt kind). `company`: the bank's name.
 * `asCash`: add it as cash whatever the bank calls it (a brokerage used as a checking account).
 */
export function newFromBank(b: BankAccount, id: string, company?: string, asCash = false): { kind: "account"; account: Account } | { kind: "debt"; debt: Debt } {
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
  if (b.type === "depository" || asCash) return { kind: "account", account: { ...base, type: "cash" } };
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
  // (a new match gets its own bank start date, when its transactions first come in)
  for (const x of [...p.accounts, ...p.debts]) if (x.plaidAccountId === b.accountId) { delete x.plaidAccountId; delete x.bankFrom; }
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

/**
 * The plan as you see it: matched accounts and debts show the bank's balance. The saved plan isn't
 * changed (a refresh isn't an edit, so it isn't synced or kept in history); this is a copy, or the same
 * plan when every balance already matches (so nothing downstream reruns).
 */
export function withBankBalances(p: PlanState, bank: BankAccount[], hasRegister: (planAccountId: string) => boolean): PlanState {
  if (!bank.length) return p;
  const by = new Map(bank.map((b) => [b.accountId, b]));
  const bankValue = (x: { id: string; plaidAccountId?: string; balance: number }) => {
    const b = x.plaidAccountId ? by.get(x.plaidAccountId) : undefined;
    if (!b || b.current == null || hasRegister(x.id)) return undefined;
    const v = Math.max(0, cents(b.current));
    return Math.abs(x.balance - v) > 0.004 ? v : undefined;
  };
  let changed = false;
  const accounts = p.accounts.map((a) => {
    const v = bankValue(a);
    if (v === undefined) return a;
    changed = true;
    return { ...a, balance: v };
  });
  const debts = p.debts.map((d) => {
    const v = bankValue(d);
    if (v === undefined) return d;
    changed = true;
    return { ...d, balance: v };
  });
  return changed ? { ...p, accounts, debts } : p;
}

/** Fill a matched debt's rate and minimum payment from the bank, only where you haven't set them. Returns whether anything changed. */
export function fillDebtTerms(p: PlanState, bank: BankAccount[]): boolean {
  const by = new Map(bank.map((b) => [b.accountId, b]));
  let changed = false;
  for (const d of p.debts) {
    const b = d.plaidAccountId ? by.get(d.plaidAccountId) : undefined;
    if (!b) continue;
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
      delete x.bankFrom;
      changed = true;
    }
  }
  return changed;
}
