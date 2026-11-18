/**
 * Import from YNAB: read its export (a zip with a Register file of transactions and a Plan/Budget
 * file of what was assigned each month), match its accounts and categories to the plan's, and turn
 * the chosen months into categories, assignments, starting balances and transactions.
 *
 * Re-importing is safe: each transaction gets the same id every time, so it replaces itself.
 */
import { startTxnId, type BudgetItem, type CardDebt, type Debt, type PlanState, type Txn } from "@coastfi/engine";
import { unzipSync, strFromU8 } from "fflate";
import { isCard } from "./register";
import { OUTSIDE } from "./outside";

/* ---------- reading the files ---------- */

/** CSV rows (quoted fields, commas and line breaks inside quotes, a BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** The Register and Plan (or Budget, in older exports) files from YNAB's export zip. */
export function readYnabZip(bytes: Uint8Array): { register: string; plan?: string } {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  const find = (re: RegExp) => names.find((n) => re.test(n.split("/").pop() ?? n));
  const reg = find(/register\.csv$/i);
  if (!reg) throw new Error("That zip doesn't have YNAB's Register file in it. In YNAB, use Export budget and upload the zip it downloads.");
  const plan = find(/(plan|budget)\.csv$/i);
  return { register: strFromU8(files[reg]!), plan: plan ? strFromU8(files[plan]!) : undefined };
}

/** "$1,234.56", "-12.30", "(5.00)", "1.234,56 €" → a number. */
export function money(raw: string): number {
  let s = (raw ?? "").trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.includes("-") || s.includes("−");
  s = s.replace(/[^0-9.,]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  // the separator that comes last (with 1–2 digits after it) is the decimal one
  if (lastComma > lastDot && s.length - lastComma <= 3) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s) || 0;
  return neg ? -n : n;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** YNAB writes dates the way your settings show them: work out which order from all of them. */
export function dateParser(samples: string[]): (s: string) => string | null {
  const parts = samples.map((s) => s.trim().split(/[/.\-]/).map(Number)).filter((p) => p.length === 3 && p.every((x) => !Number.isNaN(x)));
  const iso = parts.length > 0 && parts.every((p) => p[0]! > 31);
  const dayFirst = !iso && parts.some((p) => p[0]! > 12) && parts.every((p) => p[1]! <= 12);
  return (s) => {
    const p = s.trim().split(/[/.\-]/).map(Number);
    if (p.length !== 3 || p.some((x) => Number.isNaN(x))) return null;
    const [a, b, c] = p as [number, number, number];
    const [y, m, d] = iso ? [a, b, c] : dayFirst ? [c, b, a] : [c, a, b];
    const year = y < 100 ? 2000 + y : y;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${year}-${pad(m)}-${pad(d)}`;
  };
}

/** "Nov 2026", "November 2026", "11/2026", "2026-11" → "2026-11". */
export function monthOf(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  const named = s.match(/^([a-z]+)\.?\s+(\d{4})$/);
  if (named) {
    const m = MONTHS.indexOf(named[1]!.slice(0, 3));
    return m >= 0 ? `${named[2]}-${pad(m + 1)}` : null;
  }
  const num = s.match(/^(\d{1,2})[/\-.](\d{4})$/) ?? s.match(/^(\d{4})[/\-.](\d{1,2})$/);
  if (!num) return null;
  const [y, m] = num[1]!.length === 4 ? [num[1]!, Number(num[2])] : [num[2]!, Number(num[1])];
  return m >= 1 && m <= 12 ? `${y}-${pad(m)}` : null;
}

export type YnabTxn = {
  account: string;
  date: string;
  payee: string;
  group: string;
  category: string;
  memo: string;
  amount: number;
  cleared: Txn["cleared"];
  /** Other account, for a transfer ("Transfer : Savings"). */
  transferTo?: string;
  /** Split lines (one YNAB transaction split across categories). */
  splits?: { group: string; category: string; amount: number; memo: string }[];
};
/** A category's month in YNAB's Plan file: what you assigned, and what was available at the month's end. */
export type YnabAssigned = { month: string; group: string; category: string; assigned: number; available?: number };
export type YnabData = { txns: YnabTxn[]; assigned: YnabAssigned[] };

const col = (header: string[], ...names: string[]) => {
  const h = header.map((x) => x.trim().toLowerCase());
  for (const n of names) {
    const i = h.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
};
const READY = /^(ready to assign|to be budgeted|inflow: ready to assign|ready to assign \(inflow\))$/i;
export const isReady = (group: string, category: string) => READY.test(category.trim()) || (/^inflow$/i.test(group.trim()) && !!category.trim());
const SPLIT = /^split \((\d+)\/(\d+)\)\s*/i;

/** Read YNAB's Register and Plan files. */
export function parseYnab(registerCsv: string, planCsv?: string): YnabData {
  const reg = parseCsv(registerCsv);
  const header = reg[0] ?? [];
  const c = {
    account: col(header, "Account"),
    date: col(header, "Date"),
    payee: col(header, "Payee"),
    both: col(header, "Category Group/Category"),
    group: col(header, "Category Group"),
    category: col(header, "Category"),
    memo: col(header, "Memo"),
    out: col(header, "Outflow"),
    inflow: col(header, "Inflow"),
    amount: col(header, "Amount"),
    cleared: col(header, "Cleared"),
  };
  if (c.account < 0 || c.date < 0 || (c.amount < 0 && (c.out < 0 || c.inflow < 0)))
    throw new Error("That doesn't look like YNAB's Register file (it needs Account, Date, Outflow and Inflow columns).");
  const body = reg.slice(1);
  const toDate = dateParser(body.map((r) => r[c.date] ?? ""));
  const rows: YnabTxn[] = [];
  for (const r of body) {
    const date = toDate(r[c.date] ?? "");
    if (!date) continue;
    let group = c.group >= 0 ? (r[c.group] ?? "") : "";
    let category = c.category >= 0 ? (r[c.category] ?? "") : "";
    if ((!group || !category) && c.both >= 0) {
      const both = r[c.both] ?? "";
      const at = both.indexOf(":");
      if (at > 0) { group ||= both.slice(0, at).trim(); category ||= both.slice(at + 1).trim(); }
      else category ||= both.trim();
    }
    const payee = (r[c.payee] ?? "").trim();
    const transfer = payee.match(/^transfer\s*:\s*(.+)$/i);
    const clearedRaw = (r[c.cleared] ?? "").trim().toLowerCase();
    rows.push({
      account: (r[c.account] ?? "").trim(),
      date,
      payee: transfer ? "" : payee,
      group: group.trim(),
      category: category.trim(),
      memo: (r[c.memo] ?? "").trim(),
      amount: Math.round((c.amount >= 0 ? money(r[c.amount] ?? "") : money(r[c.inflow] ?? "") - Math.abs(money(r[c.out] ?? ""))) * 100) / 100,
      cleared: clearedRaw === "reconciled" ? "reconciled" : clearedRaw === "cleared" ? "cleared" : "uncleared",
      ...(transfer ? { transferTo: transfer[1]!.trim() } : {}),
    });
  }
  // split lines ("Split (1/3) memo") are rows of one transaction: put them back together
  const txns: YnabTxn[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const m = r.memo.match(SPLIT);
    if (!m || m[1] !== "1") {
      txns.push(m ? { ...r, memo: r.memo.replace(SPLIT, "") } : r);
      continue;
    }
    const n = Number(m[2]);
    const parts = rows.slice(i, i + n).filter((x) => x.account === r.account && x.date === r.date && SPLIT.test(x.memo));
    if (parts.length !== n) {
      txns.push({ ...r, memo: r.memo.replace(SPLIT, "") });
      continue;
    }
    txns.push({
      ...r,
      group: "",
      category: "",
      memo: "",
      amount: Math.round(parts.reduce((a, x) => a + x.amount, 0) * 100) / 100,
      splits: parts.map((x) => ({ group: x.group, category: x.category, amount: x.amount, memo: x.memo.replace(SPLIT, "") })),
    });
    i += n - 1;
  }

  const assigned: YnabAssigned[] = [];
  if (planCsv) {
    const plan = parseCsv(planCsv);
    const ph = plan[0] ?? [];
    const p = {
      month: col(ph, "Month"),
      both: col(ph, "Category Group/Category"),
      group: col(ph, "Category Group"),
      category: col(ph, "Category"),
      assigned: col(ph, "Assigned", "Budgeted"),
      available: col(ph, "Available", "Balance"),
    };
    if (p.month >= 0 && p.assigned >= 0) {
      for (const r of plan.slice(1)) {
        const month = monthOf(r[p.month] ?? "");
        if (!month) continue;
        let group = p.group >= 0 ? (r[p.group] ?? "") : "";
        let category = p.category >= 0 ? (r[p.category] ?? "") : "";
        if ((!group || !category) && p.both >= 0) {
          const both = r[p.both] ?? "";
          const at = both.indexOf(":");
          if (at > 0) { group ||= both.slice(0, at).trim(); category ||= both.slice(at + 1).trim(); }
        }
        assigned.push({ month, group: group.trim(), category: category.trim(), assigned: money(r[p.assigned] ?? ""), ...(p.available >= 0 ? { available: money(r[p.available] ?? "") } : {}) });
      }
    }
  }
  return { txns, assigned };
}

/* ---------- matching to the plan ---------- */

export type YnabAccountKind = "cash" | "card" | "invest" | "loan";
export type YnabAccount = {
  name: string;
  kind: YnabAccountKind;
  /** Today's balance in YNAB, as YNAB shows it: transactions dated after today aren't in it (a card or loan: negative, what you owe). */
  balance: number;
  /** What transactions dated after today add up to (they count on their day). */
  upcoming: number;
  /** On your YNAB budget (its transactions have categories), or a tracking account. */
  onBudget: boolean;
  txnCount: number;
};
/** What to do with a YNAB account: match one of the plan's (its id), add it, or leave it out. */
export type AccountChoice = { action: "match"; id: string } | { action: "add" } | { action: "skip" };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const CARD_GROUP = /^credit card payments$/i;
const SPECIAL_GROUP = /^(inflow|credit card payments|hidden categories|internal master category)$/i;

/** YNAB's accounts, from the register: what kind each looks like and its balance today. */
export function ynabAccounts(d: YnabData, today?: string): YnabAccount[] {
  const cards = new Set(d.assigned.filter((a) => CARD_GROUP.test(a.group)).map((a) => norm(a.category)));
  for (const t of d.txns) if (CARD_GROUP.test(t.group)) cards.add(norm(t.category));
  const by = new Map<string, YnabAccount>();
  for (const t of d.txns) {
    const a = by.get(t.account) ?? { name: t.account, kind: "cash" as YnabAccountKind, balance: 0, upcoming: 0, onBudget: false, txnCount: 0 };
    if (today && t.date > today) a.upcoming = Math.round((a.upcoming + t.amount) * 100) / 100;
    else a.balance = Math.round((a.balance + t.amount) * 100) / 100;
    a.txnCount++;
    if (t.category || t.splits?.length) a.onBudget = true;
    by.set(t.account, a);
  }
  for (const a of by.values()) {
    if (cards.has(norm(a.name))) a.kind = "card";
    else if (!a.onBudget) a.kind = /mortgage|loan|auto|car|student|heloc/i.test(a.name) || a.balance < 0 ? "loan" : "invest";
  }
  return [...by.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * The plan's account a YNAB account is: the same name (ignoring capitals and spaces) and the same
 * kind, and not one another YNAB account already took (`taken`). Otherwise add it.
 */
export function suggestChoice(plan: PlanState, a: YnabAccount, taken: Set<string> = new Set()): AccountChoice {
  const n = norm(a.name);
  const pool =
    a.kind === "cash" ? plan.accounts.filter((x) => x.type === "cash").map((x) => ({ id: x.id, name: x.name }))
    : a.kind === "card" ? plan.debts.filter(isCard).map((x) => ({ id: x.id, name: x.name }))
    : a.kind === "loan" ? plan.debts.filter((x) => !isCard(x)).map((x) => ({ id: x.id, name: x.name }))
    : plan.accounts.filter((x) => x.type !== "cash").map((x) => ({ id: x.id, name: x.name }));
  const hit = pool.find((x) => norm(x.name) === n && !taken.has(x.id));
  return hit ? { action: "match", id: hit.id } : { action: "add" };
}

export type YnabCategory = { group: string; name: string; average: number };
/** What to do with a YNAB category: add it, put it into one of the plan's (a category id, or "cash" for the Emergency fund), or leave it out. */
/** What a YNAB category becomes: a new category, one of yours, a hidden category (keeps its transactions, off the budget and plan), or nothing. */
export type CategoryChoice = { action: "new" } | { action: "match"; id: string } | { action: "hidden" } | { action: "skip" };

/** The plan's category a YNAB category most likely is: the same name, or the Emergency fund for an emergency fund. */
export function suggestCategory(plan: PlanState, c: Pick<YnabCategory, "name">): CategoryChoice {
  const hit = plan.budget.find((b) => !b.accountId && norm(b.name) === norm(c.name));
  if (hit) return { action: "match", id: hit.id };
  if (/emergency/i.test(c.name)) return { action: "match", id: "cash" };
  return { action: "new" };
}

/** YNAB's own categories (not Ready to Assign or card payments), with what you assigned a month on average lately. */
export function ynabCategories(d: YnabData, months: string[]): YnabCategory[] {
  const seen = new Map<string, YnabCategory>();
  const key = (g: string, c: string) => norm(g) + "\u0000" + norm(c);
  const add = (group: string, name: string) => {
    if (!name || SPECIAL_GROUP.test(group) || isReady(group, name)) return;
    if (!seen.has(key(group, name))) seen.set(key(group, name), { group, name, average: 0 });
  };
  for (const a of d.assigned) add(a.group, a.category);
  for (const t of d.txns) {
    add(t.group, t.category);
    for (const s of t.splits ?? []) add(s.group, s.category);
  }
  // only the months YNAB has (a budget started last month has one month to go on)
  const recent = new Set(months.filter((m) => d.assigned.some((a) => a.month === m)));
  for (const c of seen.values()) {
    const vals = d.assigned.filter((a) => recent.has(a.month) && key(a.group, a.category) === key(c.group, c.name));
    c.average = vals.length ? Math.round(vals.reduce((t, a) => t + Math.max(0, a.assigned), 0) / Math.max(1, recent.size)) : 0;
  }
  return [...seen.values()];
}

/**
 * YNAB accounts (investments, loans) matched to one of yours with a different balance: you pick which
 * balance to keep. Cash accounts and cards follow their transactions, so they aren't here.
 */
export function balanceConflicts(plan: PlanState, accts: YnabAccount[], choices: Record<string, AccountChoice>): { name: string; yours: number; ynab: number; owed: boolean }[] {
  return accts.flatMap((a) => {
    const ch = choices[a.name];
    if (ch?.action !== "match" || a.kind === "cash" || a.kind === "card") return [];
    const acct = plan.accounts.find((x) => x.id === ch.id);
    const debt = plan.debts.find((x) => x.id === ch.id);
    const yours = acct ? acct.balance : debt ? debt.balance : undefined;
    const ynab = debt ? Math.max(0, -a.balance) : a.balance;
    return yours !== undefined && Math.abs(yours - ynab) >= 0.005 ? [{ name: a.name, yours, ynab, owed: !!debt }] : [];
  });
}

/* ---------- what the import does ---------- */

export type ImportOptions = {
  /** First month to bring in, "YYYY-MM" (null = everything). */
  from: string | null;
  /** This month, "YYYY-MM". */
  thisMonth: string;
  /** Today, "YYYY-MM-DD": balances are as of today (later transactions count on their day). Without it, everything counts. */
  today?: string;
  accounts: Record<string, AccountChoice>;
  /**
   * Per YNAB account matched to an investment account or loan of yours: take YNAB's balance (true) instead
   * of keeping yours (the default: YNAB's tracking balances are often out of date, or $0).
   */
  useYnabBalance?: Record<string, boolean>;
  /** Per YNAB category ("group\u0000name"): still paid after you retire, and essential. */
  categories: Record<string, { inRetirement: boolean; essential: boolean }>;
  /** Per YNAB category: add it, put it into one of the plan's, or leave it out (default: suggestCategory). */
  categoryMap?: Record<string, CategoryChoice>;
  /** Per YNAB group (groupKey): the group its categories land in here (default: the same name). */
  groupMap?: Record<string, string>;
  /** Per YNAB category (categoryKey): the group it lands in, in place of its YNAB group's (groupMap). */
  categoryGroup?: Record<string, string>;
  /** Per YNAB category (categoryKey): what it gets a month here, in place of YNAB's recent average. */
  amounts?: Record<string, number>;
  /** Take out the plan's own categories that are still $0 and YNAB doesn't have. */
  removeEmpty: boolean;
  /** Transactions already here, and whether the ones YNAB also has (same account and amount, within 3 days) give way to YNAB's. */
  existing?: Txn[];
  replaceMatching?: boolean;
  /** Matches you said aren't the same transaction (your transaction's id): both stay. */
  keepBoth?: string[];
  /** Ids for what the import adds (tests); without it, ids come from YNAB's names (see nameId). */
  newId?: () => string;
};
export const categoryKey = (group: string, name: string) => norm(group) + "\u0000" + norm(name);
/** A YNAB group, for `groupMap`. */
export const groupKey = (group: string) => norm(group);

export type ImportResult = {
  plan: PlanState;
  txns: Txn[];
  /** Your own transactions that YNAB's replace (to delete). */
  replaced: string[];
  /** Each of your transactions paired with the YNAB one that looks like the same (for you to confirm). */
  matches: { mine: Txn; ynab: Txn }[];
  summary: {
    accountsAdded: number; accountsRemoved: number; categoriesAdded: number; categoriesUpdated: number; categoriesRemoved: number; categoriesSkipped: number; categoriesHidden: number;
    transactions: number; transactionsMatched: number; months: number;
    /** Recent transactions (this month and last) that will need a category: YNAB had none, or you left their category out. */
    needsCategoryFromYnab: number; needsCategoryLeftOut: number;
    /** Older ones without a category: kept as history, nothing to do. */
    olderWithoutCategory: number;
    /** Transfers to accounts you left out: kept as transfers, nothing to do. */
    transfersOutside: number;
  };
};

/** A stable id for a YNAB transaction, so importing it again replaces it instead of adding it twice. */
function stableId(t: YnabTxn, n: number): string {
  return "ynab-" + hash([t.account, t.date, t.payee, t.transferTo ?? "", t.amount, t.memo, t.category, n].join("|"));
}

/**
 * An id for an account or category the import adds, from its YNAB name: the same on every device,
 * so if the import runs twice (or another device's copy of it wins a sync) its transactions still
 * point at it. Never one the plan already uses.
 */
export function nameId(kind: "acct" | "cat", name: string, used: Set<string>): string {
  const base = `ynab-${kind}-${hash(name.trim().toLowerCase())}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619) >>> 0;
    h2 = (Math.imul(h2, 31) + text.charCodeAt(i)) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

const addMonthsTo = (ym: string, n: number) => {
  const k = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(k / 12)}-${pad((k % 12) + 1)}`;
};
/** Every month from the export's first transaction or assignment through this one, newest first. */
export function exportMonths(d: YnabData, thisMonth: string): string[] {
  const all = [...d.txns.map((t) => t.date.slice(0, 7)), ...d.assigned.map((a) => a.month)].filter((m) => m && m <= thisMonth);
  const first = all.reduce((a, m) => (m < a ? m : a), thisMonth);
  const out: string[] = [];
  for (let m = thisMonth; m >= first; m = addMonthsTo(m, -1)) out.push(m);
  return out;
}

/** The full months before this one, newest last (for the averages). */
export const recentMonths = (thisMonth: string, n = 3) => Array.from({ length: n }, (_, i) => addMonthsTo(thisMonth, i - n));

/** Turn YNAB's data into the plan's categories, assignments, accounts and transactions. */
export function buildImport(input: PlanState, d: YnabData, o: ImportOptions): ImportResult {
  const plan = structuredClone(input);
  const summary = { accountsAdded: 0, accountsRemoved: 0, categoriesAdded: 0, categoriesUpdated: 0, categoriesRemoved: 0, categoriesSkipped: 0, categoriesHidden: 0, transactions: 0, transactionsMatched: 0, months: 0, needsCategoryFromYnab: 0, needsCategoryLeftOut: 0, olderWithoutCategory: 0, transfersOutside: 0 };
  // only this month's and last month's transactions are asked for a category (older ones are history)
  const [ty, tm] = o.thisMonth.split("-").map(Number) as [number, number];
  const recentFrom = tm === 1 ? `${ty - 1}-12-01` : `${ty}-${String(tm - 1).padStart(2, "0")}-01`;
  const accts = ynabAccounts(d, o.today);

  // accounts: matched, added, or left out
  const idOf = new Map<string, string>();
  const kindOf = new Map<string, YnabAccountKind>();
  const taken = new Set<string>();
  const used = new Set<string>([...plan.accounts, ...plan.debts, ...plan.budget, ...(plan.properties ?? [])].map((x) => x.id));
  const idFor = (kind: "acct" | "cat", name: string) => (o.newId ? o.newId() : nameId(kind, name, used));
  for (const a of accts) {
    let ch = o.accounts[a.name] ?? suggestChoice(plan, a, new Set([...taken, ...Object.values(o.accounts).flatMap((c) => (c.action === "match" ? [c.id] : []))]));
    // one YNAB account per account here: a second one pointed at it is added instead of merged
    if (ch.action === "match" && taken.has(ch.id)) ch = { action: "add" };
    if (ch.action === "match") taken.add(ch.id);
    if (ch.action === "skip") continue;
    kindOf.set(a.name, a.kind);
    if (ch.action === "match") { idOf.set(a.name, ch.id); continue; }
    const id = idFor("acct", a.name);
    idOf.set(a.name, id);
    summary.accountsAdded++;
    if (a.kind === "cash") plan.accounts.push({ id, name: a.name, type: "cash", balance: a.balance });
    else if (a.kind === "invest") plan.accounts.push({ id, name: a.name, type: "taxable", balance: a.balance });
    else {
      const debt: Debt = { id, name: a.name, kind: a.kind === "card" ? "credit_card" : /mortgage/i.test(a.name) ? "mortgage" : /student/i.test(a.name) ? "student" : /auto|car/i.test(a.name) ? "car" : "other", balance: Math.max(0, -a.balance), apr: a.kind === "card" ? 0.24 : 0.06, minPayment: 0 };
      plan.debts.push(debt);
    }
  }
  // tracking accounts (investments, loans): their transactions aren't budget transactions. One that's new
  // here starts at YNAB's balance; one matched to yours keeps your balance unless you picked YNAB's
  for (const a of accts) {
    const id = idOf.get(a.name);
    if (!id || a.kind === "cash" || a.kind === "card") continue;
    if (o.accounts[a.name]?.action === "match" && !o.useYnabBalance?.[a.name]) continue;
    const acct = plan.accounts.find((x) => x.id === id);
    if (acct) acct.balance = a.balance;
    const debt = plan.debts.find((x) => x.id === id);
    if (debt) debt.balance = Math.max(0, -a.balance);
  }
  // setup's empty "Savings / checking": once YNAB brings in your checking and savings, a $0 cash account
  // nothing uses is just clutter (one with money, transactions, a link or a bank connection stays)
  if (accts.some((a) => a.kind === "cash" && idOf.has(a.name))) {
    const used = new Set<string>([
      ...idOf.values(),
      ...plan.budget.flatMap((b) => (b.accountId ? [b.accountId] : [])),
      ...(o.existing ?? []).filter((t) => !t.deleted).flatMap((t) => [t.accountId, ...(t.transferAccountId ? [t.transferAccountId] : [])]),
    ]);
    const before = plan.accounts.length;
    plan.accounts = plan.accounts.filter((x) => !(x.type === "cash" && Math.abs(x.balance) < 0.005 && !used.has(x.id) && !x.plaidAccountId));
    summary.accountsRemoved = before - plan.accounts.length;
  }

  // categories: YNAB's, put into the plan's (by your choice, else the same name), added in YNAB's group, or left out
  const months = recentMonths(o.thisMonth);
  const cats = ynabCategories(d, months);
  const itemOf = new Map<string, string>();
  const matchedAmount = new Map<string, number>();
  const groupFor = (g: string) => o.groupMap?.[groupKey(g)] ?? g;
  // hidden ones go after everything shown (that's where hidden categories live)
  const hiddenItems: BudgetItem[] = [];
  for (const c of cats) {
    const k = categoryKey(c.group, c.name);
    const opts = o.categories[k] ?? { inRetirement: true, essential: true };
    const ch = o.categoryMap?.[k] ?? suggestCategory(plan, c);
    if (ch.action === "skip") { summary.categoriesSkipped++; continue; }
    if (ch.action === "hidden") {
      const id = idFor("cat", k);
      itemOf.set(k, id);
      hiddenItems.push({ id, name: c.name, amount: 0, inRetirement: false, group: (o.categoryGroup?.[k] ?? groupFor(c.group)) || undefined, hidden: true });
      summary.categoriesHidden++;
      continue;
    }
    const hit = ch.action === "match" ? plan.budget.find((b) => b.id === ch.id) : undefined;
    if (ch.action === "match" && ch.id === "cash") { itemOf.set(k, "cash"); summary.categoriesUpdated++; continue; }
    // one of your hidden categories: it just takes the transactions (no amount, still hidden)
    if (hit?.hidden) { itemOf.set(k, hit.id); summary.categoriesUpdated++; continue; }
    if (hit) {
      itemOf.set(k, hit.id);
      // two of YNAB's put into one: their amounts add up
      const mine = o.amounts?.[k];
      const amount = (matchedAmount.get(hit.id) ?? 0) + (mine ?? c.average);
      matchedAmount.set(hit.id, amount);
      if (amount > 0 || mine !== undefined) hit.amount = amount;
      hit.inRetirement = opts.inRetirement;
      hit.essential = opts.essential;
      if (!matchedAmount.has(hit.id + ":group")) { hit.group = o.categoryGroup?.[k] ?? (groupFor(c.group) || hit.group); matchedAmount.set(hit.id + ":group", 1); }
      summary.categoriesUpdated++;
      continue;
    }
    const id = idFor("cat", k);
    itemOf.set(k, id);
    const item: BudgetItem = { id, name: c.name, amount: o.amounts?.[k] ?? c.average, inRetirement: opts.inRetirement, group: (o.categoryGroup?.[k] ?? groupFor(c.group)) || undefined, essential: opts.essential };
    plan.budget.push(item);
    summary.categoriesAdded++;
  }
  plan.budget.push(...hiddenItems);
  if (o.removeEmpty) {
    const keep = new Set(itemOf.values());
    const before = plan.budget.length;
    plan.budget = plan.budget.filter((b) => keep.has(b.id) || b.amount !== 0 || !!b.accountId);
    summary.categoriesRemoved = before - plan.budget.length;
  }
  // a YNAB category → the plan's: Ready to Assign, a card's payment, or a category
  const cardIdByName = new Map<string, string>();
  for (const a of accts) if (a.kind === "card" && idOf.get(a.name)) cardIdByName.set(norm(a.name), idOf.get(a.name)!);
  const catOf = (group: string, name: string): string | undefined => {
    if (!name && !group) return undefined;
    if (isReady(group, name)) return "ready";
    if (CARD_GROUP.test(group)) { const card = cardIdByName.get(norm(name)); return card ? "debt:" + card : undefined; }
    return itemOf.get(categoryKey(group, name));
  };

  // the months to bring in
  const first = d.txns.reduce((m, t) => (t.date.slice(0, 7) < m ? t.date.slice(0, 7) : m), o.thisMonth);
  const from = o.from && o.from > first ? o.from : first;
  const inRange = (date: string) => date.slice(0, 7) >= from;

  // the budget starts last month at the earliest, from YNAB's own numbers: older months are history (their
  // transactions come in, but closed accounts and gaps in old history can't throw the budget off). Its
  // first month starts with what each category had available in YNAB the month before.
  const lastMonth = recentFrom.slice(0, 7);
  const budgetFrom = from > lastMonth ? from : lastMonth;
  if (!plan.budgetPlan) plan.budgetPlan = { start: budgetFrom, startCash: 0, months: {} };
  if (plan.budgetPlan.start > budgetFrom) plan.budgetPlan.start = budgetFrom;
  // YNAB's budget replaces these months whole: an amount left on a line YNAB doesn't have (say a loan
  // payment line budgeted here before the import, while YNAB pays it from its own category) would
  // count the same money twice. Later months are left alone.
  for (let m = budgetFrom; m <= o.thisMonth; m = addMonthsTo(m, 1)) {
    const e = plan.budgetPlan.months[m];
    if (e?.assigned || e?.cardDebt) {
      const { assigned: _old, cardDebt: _oldDebt, ...rest } = e;
      plan.budgetPlan.months[m] = rest;
    }
  }
  const monthsTouched = new Set<string>();
  const setHere = new Set<string>();
  const carryMonth = addMonthsTo(budgetFrom, -1);
  const carried = d.assigned.filter((a) => a.month === carryMonth && (a.available ?? 0) > 0).map((a) => ({ ...a, month: budgetFrom, assigned: a.available! }));
  for (const a of [...d.assigned, ...carried]) {
    if (a.month < budgetFrom || a.month > o.thisMonth || !a.assigned) continue;
    const key = catOf(a.group, a.category);
    if (!key || key === "ready") continue;
    const e = (plan.budgetPlan.months[a.month] ??= {});
    // YNAB's amount replaces what was here; two of YNAB's into one category add up
    // (the month before's available, carried into the first month, adds to that month's own)
    const prev = setHere.has(a.month + "|" + key) ? (e.assigned?.[key] ?? 0) : 0;
    setHere.add(a.month + "|" + key);
    // a negative amount is money moved out of the category in YNAB: it nets against the rest (the month
    // before's money carried in, say), and only the total can't go below zero (as a budget amount here can't)
    e.assigned = { ...(e.assigned ?? {}), [key]: Math.round((prev + a.assigned) * 100) / 100 };
    monthsTouched.add(a.month);
  }
  for (const m of monthsTouched) {
    const e = plan.budgetPlan.months[m]!;
    e.assigned = Object.fromEntries(Object.entries(e.assigned ?? {}).map(([k, v]) => [k, Math.max(0, v)]));
  }
  summary.months = monthsTouched.size;

  // transactions in budget accounts (cash and cards), each account starting with its balance then
  const txns: Txn[] = [];
  const now = Date.now();
  const budgetAccount = (name: string) => !!idOf.get(name) && (kindOf.get(name) === "cash" || kindOf.get(name) === "card");
  const before = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const t of d.txns) {
    if (!budgetAccount(t.account)) continue;
    if (!inRange(t.date)) { before.set(t.account, Math.round(((before.get(t.account) ?? 0) + t.amount) * 100) / 100); continue; }
    const base = [t.account, t.date, t.amount, t.payee].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = stableId(t, n);
    const to = t.transferTo ? idOf.get(t.transferTo) : undefined;
    const toBudget = !!t.transferTo && budgetAccount(t.transferTo);
    const tx: Txn = {
      id, accountId: idOf.get(t.account)!, date: t.date, amount: t.amount,
      ...(t.payee ? { payee: t.payee } : {}), ...(t.memo ? { memo: t.memo } : {}),
      cleared: t.cleared, source: "ynab", importId: id, updatedAt: now,
    };
    // a split line whose category has nowhere to go stays (with no category), so the split adds up
    // a category that wasn't brought in is kept (hidden) as "Group: Category", for sorting old spending later
    const original = (group: string, name: string) => (name || group ? [group, name].filter(Boolean).join(": ") : undefined);
    if (t.splits?.length)
      tx.splits = t.splits.map((s) => {
        const k = catOf(s.group, s.category);
        const orig = !k ? original(s.group, s.category) : undefined;
        return { categoryId: k ?? "", amount: s.amount, ...(s.memo ? { memo: s.memo } : {}), ...(orig ? { originalCategory: orig } : {}) };
      });
    else {
      const k = catOf(t.group, t.category);
      if (k) tx.categoryId = k;
      else { const orig = original(t.group, t.category); if (orig) tx.originalCategory = orig; }
    }
    // needs a category here: YNAB had none, or its category was left out
    const hadCategory = t.splits?.length ? t.splits.every((s) => !!s.category) : !!t.category;
    // a transfer to an account you left out (an old or closed one): still a transfer, not spending, so it
    // needs no category (it points at that account by name, since there's no account here for it)
    const outside = !!t.transferTo && !to && !tx.categoryId && !t.splits?.length;
    const missing = t.splits?.length ? tx.splits!.some((s) => !s.categoryId) : !tx.categoryId && !(to && toBudget) && !outside;
    if (outside) summary.transfersOutside++;
    if (missing && t.date < recentFrom) summary.olderWithoutCategory++;
    else if (missing) {
      if (hadCategory) summary.needsCategoryLeftOut++;
      else summary.needsCategoryFromYnab++;
    }
    if (to) tx.transferAccountId = to;
    else if (outside) tx.transferAccountId = OUTSIDE + t.transferTo;
    // money into a card from a budget account: the card's payment
    if (to && toBudget && kindOf.get(t.account) === "card" && t.amount > 0) delete tx.categoryId;
    // a transfer between two budget accounts has no category
    if (to && toBudget) delete tx.categoryId;
    txns.push(tx);
  }
  // pair up transfers between budget accounts (each side points at the other)
  const open = txns.filter((x) => x.transferAccountId && txns.some((y) => y.accountId === x.transferAccountId));
  for (const x of open) {
    if (x.transferId) continue;
    const y = open.find((z) => !z.transferId && z !== x && z.accountId === x.transferAccountId && z.transferAccountId === x.accountId && z.date === x.date && Math.abs(z.amount + x.amount) < 0.005);
    if (y) { x.transferId = y.id; y.transferId = x.id; }
  }
  // YNAB lets overspending on a credit card turn into card debt: the card's payment category only gets
  // what the category could cover. Bring that in as it was, as overspending left on the card (it shows
  // short on the card's line here, and isn't taken from Unassigned), so the budget starts where YNAB's is.
  // A category that went over is counted as overspent on its cards first, up to what it spent on them.
  const cardIds = new Set([...idOf].filter(([n]) => kindOf.get(n) === "card").map(([, id]) => id));
  for (let m = budgetFrom; m <= o.thisMonth; m = addMonthsTo(m, 1)) {
    const debt: CardDebt[] = [];
    const done = new Set<string>();
    for (const a of d.assigned) {
      if (a.month !== m || (a.available ?? 0) > -0.005 || CARD_GROUP.test(a.group)) continue;
      const key = catOf(a.group, a.category);
      if (!key || key === "ready" || key.startsWith("debt:") || done.has(key)) continue;
      done.add(key);
      const byCard = new Map<string, number>();
      for (const t of txns) {
        if (t.date.slice(0, 7) !== m || !cardIds.has(t.accountId) || (o.today && t.date > o.today)) continue;
        const parts = t.splits?.length ? t.splits : [{ categoryId: t.categoryId ?? "", amount: t.amount }];
        for (const p of parts) if (p.categoryId === key) byCard.set("debt:" + t.accountId, (byCard.get("debt:" + t.accountId) ?? 0) - p.amount);
      }
      const total = [...byCard.values()].reduce((x, v) => x + Math.max(0, v), 0);
      const onCards = Math.min(-a.available!, total);
      if (onCards < 0.005) continue;
      for (const [card, spent] of byCard) if (spent > 0) debt.push({ cat: key, card, amount: Math.round((onCards * spent) / total * 100) / 100 });
    }
    if (debt.length) plan.budgetPlan.months[m] = { ...(plan.budgetPlan.months[m] ?? {}), cardDebt: debt };
  }
  // each budget account starts with its balance at the first imported day. Bringing in everything,
  // that's YNAB's own "Starting Balance" transaction.
  for (const [name, id] of idOf) {
    if (!budgetAccount(name)) continue;
    const card = kindOf.get(name) === "card";
    const ynabStart = before.has(name) ? undefined : txns.find((x) => x.accountId === id && /^starting balance$/i.test(x.payee ?? ""));
    if (ynabStart) {
      ynabStart.id = startTxnId(id);
      ynabStart.importId = startTxnId(id);
      ynabStart.payee = "Starting balance";
      continue;
    }
    txns.unshift({
      id: startTxnId(id), accountId: id, date: `${from}-01`, amount: before.get(name) ?? 0, payee: "Starting balance",
      ...(card ? {} : { categoryId: "ready" }), cleared: "reconciled", source: "ynab", updatedAt: now,
    });
  }
  // your own transactions that YNAB also has give way to YNAB's (same account and amount, within 3 days)
  const matches: { mine: Txn; ynab: Txn }[] = [];
  if (o.existing?.length) {
    const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
    const ids = new Set(txns.map((x) => x.id));
    const pool = o.existing.filter((x) => !x.deleted && x.source !== "ynab" && !ids.has(x.id) && !x.id.startsWith("start:"));
    const taken = new Set<string>();
    for (const y of txns) {
      if (y.id.startsWith("start:")) continue;
      // the closest date wins when several of yours could be this one
      const hit = pool
        .filter((x) => !taken.has(x.id) && x.accountId === y.accountId && Math.abs(x.amount - y.amount) < 0.005 && days(x.date, y.date) <= 3)
        .sort((a, b) => days(a.date, y.date) - days(b.date, y.date))[0];
      if (hit) { taken.add(hit.id); matches.push({ mine: hit, ynab: y }); }
    }
  }
  const keep = new Set(o.keepBoth ?? []);
  const replaced = o.replaceMatching === false ? [] : matches.filter((m) => !keep.has(m.mine.id)).map((m) => m.mine.id);
  summary.transactionsMatched = replaced.length;
  summary.transactions = txns.length;
  return { plan, txns, replaced, matches, summary };
}
