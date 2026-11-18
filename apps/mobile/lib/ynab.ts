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
import { fullName } from "./company";
import { OUTSIDE } from "./outside";
import { CLOSED_ACCOUNTS_GROUP } from "./budgetOrder";
import { linkDebtCategories, PAYS } from "./debtLink";

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
/** A category's month in YNAB's Plan file: what you assigned, what it spent (activity), and what was available at the month's end. */
export type YnabAssigned = { month: string; group: string; category: string; assigned: number; activity?: number; available?: number };
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
      activity: col(ph, "Activity"),
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
        assigned.push({ month, group: group.trim(), category: category.trim(), assigned: money(r[p.assigned] ?? ""), ...(p.activity >= 0 ? { activity: money(r[p.activity] ?? "") } : {}), ...(p.available >= 0 ? { available: money(r[p.available] ?? "") } : {}) });
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
const SPECIAL_GROUP = /^(inflow|credit card payments|internal master category)$/i;
/** YNAB's group for categories you hid there: real categories (money is assigned and spent in them), just out of sight. */
const YNAB_HIDDEN = /^hidden categories$/i;

/** YNAB's accounts, from the register: what kind each looks like and its balance today. */
export function ynabAccounts(d: YnabData, today?: string): YnabAccount[] {
  // what YNAB hasn't approved yet doesn't count in its balances
  const held = today ? heldInYnab(d, today.slice(0, 7), today) : new Set<YnabTxn>();
  const cards = new Set(d.assigned.filter((a) => CARD_GROUP.test(a.group)).map((a) => norm(a.category)));
  for (const t of d.txns) if (CARD_GROUP.test(t.group)) cards.add(norm(t.category));
  const by = new Map<string, YnabAccount>();
  for (const t of d.txns) {
    const a = by.get(t.account) ?? { name: t.account, kind: "cash" as YnabAccountKind, balance: 0, upcoming: 0, onBudget: false, txnCount: 0 };
    if (today && t.date > today) a.upcoming = Math.round((a.upcoming + t.amount) * 100) / 100;
    else if (held.has(t)) { /* not approved in YNAB yet */ }
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
  // names compared on letters and digits only, with the company in front ("Chase · Sapphire" is "Chase - Sapphire")
  const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const bare = (x: string) => x.replace(/\([^)]*\)/g, "");
  const n = key(a.name);
  // what each of yours holds, the way YNAB shows it (a card or loan owed is negative)
  const pool =
    a.kind === "cash" ? plan.accounts.filter((x) => x.type === "cash").map((x) => ({ id: x.id, name: fullName(x), bal: x.balance }))
    : a.kind === "card" ? plan.debts.filter(isCard).map((x) => ({ id: x.id, name: fullName(x), bal: -x.balance }))
    : a.kind === "loan" ? plan.debts.filter((x) => !isCard(x)).map((x) => ({ id: x.id, name: fullName(x), bal: -x.balance }))
    : plan.accounts.filter((x) => x.type !== "cash").map((x) => ({ id: x.id, name: fullName(x), bal: x.balance }));
  const free = pool.filter((x) => !taken.has(x.id));
  const hit =
    free.find((x) => key(x.name) === n) ??
    // the same name but for a note in brackets ("Fidelity - Bill Pay" for "Fidelity - Bill Pay (Joint)")
    free.find((x) => key(bare(x.name)) === key(bare(a.name)) && !!key(bare(a.name))) ??
    // a different name, but exactly the same balance (not $0): the same account, renamed
    (Math.abs(a.balance) >= 0.01 ? (() => { const same = free.filter((x) => Math.abs(x.bal - a.balance) < 0.005); return same.length === 1 ? same[0] : undefined; })() : undefined);
  return hit ? { action: "match", id: hit.id } : { action: "add" };
}

export type YnabCategory = { group: string; name: string; average: number };
/** What to do with a YNAB category: add it, put it into one of the plan's (a category id, or "cash" for the Emergency fund), or leave it out. */
/** What a YNAB category becomes: a new category, one of yours, a hidden category (keeps its transactions, off the budget and plan), or nothing. */
export type CategoryChoice =
  | { action: "new" }
  | { action: "match"; id: string }
  | { action: "hidden" }
  | { action: "skip" }
  /** Into another of YNAB's categories (its categoryKey): one category here, with both's transactions and amounts. */
  | { action: "combine"; into: string }
  /** Money moved into an account (an IRA, an HSA): "plan:<id>" for one of yours, "ynab:<name>" for one the import adds. */
  | { action: "invest"; account: string }
  /** A new category that pays a loan (each home's PITI its own mortgage): "plan:<id>" for one of yours, "ynab:<name>" for one the import adds. */
  | { action: "loan"; debt: string };

/** The plan's category a YNAB category most likely is: the same name, or the Emergency fund for an emergency fund. */
export function suggestCategory(plan: PlanState, c: Pick<YnabCategory, "name"> & { group?: string }): CategoryChoice {
  const hit = plan.budget.find((b) => !b.accountId && norm(b.name) === norm(c.name));
  if (hit) return { action: "match", id: hit.id };
  if (/emergency/i.test(c.name)) return { action: "match", id: "cash" };
  // hidden in YNAB: hidden here too (its money and spending still count, as they do in YNAB)
  if (c.group && YNAB_HIDDEN.test(c.group)) return { action: "hidden" };
  return { action: "new" };
}

/**
 * What each of YNAB's categories should most likely become, looking at them all together: suggestCategory,
 * plus these.
 * - An old card's payment line (hidden in YNAB, named like an account) that never held money or a
 *   transaction: left out.
 * - Named like one of your investment accounts (exactly one): money moved into it ("Roth IRA" for your
 *   "Fidelity - Roth IRA").
 * - The same name but for a note in brackets ("Wedding Expenses ($500/month)" and "Wedding Expenses"):
 *   combined into one (the one shown in YNAB, else the one without the note).
 */
export function suggestCategories(plan: PlanState, d: YnabData, cats: YnabCategory[], today?: string): Record<string, CategoryChoice> {
  const key = (x: string) => x.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, "");
  const out: Record<string, CategoryChoice> = {};
  const accountNames = new Set(d.txns.map((t) => norm(t.account)));
  // used in the last year (an old card's line held money years ago, when the card was open)
  const cut = today ? `${+today.slice(0, 4) - 1}${today.slice(4, 7)}` : "";
  const used = new Set<string>();
  for (const t of d.txns) if (t.date.slice(0, 7) >= cut) for (const x of t.splits?.length ? t.splits : [t]) if (x.category) used.add(categoryKey(x.group, x.category));
  for (const a of d.assigned) if (a.month >= cut && (Math.abs(a.assigned) > 0.005 || Math.abs(a.available ?? 0) > 0.005)) used.add(categoryKey(a.group, a.category));
  // investment accounts a category can be money moved into: yours, and the ones the import would add
  const invest = [
    ...plan.accounts.filter((a) => a.type !== "cash" && a.type !== "property").map((a) => ({ account: "plan:" + a.id, names: [a.name, fullName(a)] })),
    ...ynabAccounts(d, today).filter((a) => a.kind === "invest" && !plan.accounts.some((x) => norm(fullName(x)) === norm(a.name) || norm(x.name) === norm(a.name))).map((a) => ({ account: "ynab:" + a.name, names: [a.name] })),
  ];
  for (const c of cats) {
    const k = categoryKey(c.group, c.name);
    let ch = suggestCategory(plan, c);
    if (ch.action === "hidden" && accountNames.has(norm(c.name)) && !used.has(k)) ch = { action: "skip" };
    else if (ch.action === "new" || ch.action === "hidden") {
      const n = key(c.name);
      const hits = n.length >= 3 ? invest.filter((x) => x.names.some((m) => key(m) === n || key(m).endsWith(n))) : [];
      if (hits.length === 1) ch = { action: "invest", account: hits[0]!.account };
    }
    out[k] = ch;
  }
  // pays one of your loans (a home's PITI, under a group named like the home): its own category, linked to it
  const loans = [
    ...plan.debts.filter((x) => x.kind !== "credit_card" && !x.payroll).map((x) => ({ debt: "plan:" + x.id, names: [x.name, fullName(x)] })),
    ...ynabAccounts(d, today).filter((a) => a.kind === "loan" && !plan.debts.some((x) => norm(fullName(x)) === norm(a.name) || norm(x.name) === norm(a.name))).map((a) => ({ debt: "ynab:" + a.name, names: [a.name] })),
  ];
  const loanKey = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const loanTaken = new Set<string>();
  for (const c of cats) {
    const k = categoryKey(c.group, c.name);
    if (out[k]!.action !== "new" || !PAYS.test(c.name)) continue;
    const g = loanKey(c.group);
    const n = loanKey(c.name);
    const hits = loans.filter((l) => !loanTaken.has(l.debt) && l.names.map(loanKey).some((m) => m.length >= 4 && (m === g || (g.length >= 4 && m.includes(g)) || n.includes(m))));
    if (hits.length === 1) { out[k] = { action: "loan", debt: hits[0]!.debt }; loanTaken.add(hits[0]!.debt); }
  }
  // the same category twice (a note in brackets apart): one, the other combined into it
  const byName = new Map<string, YnabCategory[]>();
  for (const c of cats) {
    const ch = out[categoryKey(c.group, c.name)]!;
    if (ch.action !== "new" && ch.action !== "hidden") continue;
    const n = key(c.name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), c]);
  }
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    const shown = (c: YnabCategory) => out[categoryKey(c.group, c.name)]!.action !== "hidden";
    const noNote = (c: YnabCategory) => !/\(/.test(c.name);
    // only a note apart: the same name twice in different groups is two things (each house's PITI)
    const main = list.find((c) => shown(c) && noNote(c)) ?? list.find(noNote);
    if (!main) continue;
    for (const c of list) if (c !== main && !noNote(c)) out[categoryKey(c.group, c.name)] = { action: "combine", into: categoryKey(main.group, main.name) };
  }
  // an old or hidden one whose transactions went to the same places as one you use: combined into it
  const isOld = (k: string) => out[k]!.action === "hidden" || (out[k]!.action === "new" && !used.has(k));
  const from = cats.map((c) => categoryKey(c.group, c.name)).filter(isOld);
  const into = cats.map((c) => categoryKey(c.group, c.name)).filter((k) => (out[k]!.action === "new" || out[k]!.action === "match" || out[k]!.action === "loan") && used.has(k));
  for (const [k, m] of Object.entries(payeeMatches(d, from, into))) out[k] = { action: "combine", into: m.into };
  return out;
}

/** A payee's name without store numbers and the like ("KROGER #123" and "Kroger" are one). */
export const payeeKey = (p: string) =>
  p.toLowerCase().replace(/#\s*\d+|\d+/g, " ").replace(/[^a-z&']+/g, " ").trim().split(/\s+/).slice(0, 3).join(" ");
const NOT_A_PAYEE = /^(starting balance|reconciliation balance adjustment|manual balance adjustment|transfer :.*)$/i;

/** Why a category was matched to another by payee: where most of its transactions went. */
export type PayeeMatch = { into: string; payees: string[]; matched: number; of: number };

/**
 * Categories (`from`, categoryKeys) whose transactions mostly went to the same payees as one other
 * category (`into`): Kroger and Aldi → Groceries. A payee used across many categories (Amazon, Target)
 * counts for less. Needs at least 3 transactions, half or more of them matching, and a clear winner.
 */
export function payeeMatches(d: YnabData, from: string[], into: string[], o: { minTxns?: number; minShare?: number } = {}): Record<string, PayeeMatch> {
  const minTxns = o.minTxns ?? 3;
  const minShare = o.minShare ?? 0.5;
  const fromSet = new Set(from);
  const intoSet = new Set(into);
  // each category's transactions by payee
  const byCat = new Map<string, Map<string, number>>();
  const names = new Map<string, string>();
  for (const t of d.txns) {
    if (t.transferTo || NOT_A_PAYEE.test(t.payee.trim())) continue;
    const pk = payeeKey(t.payee);
    if (!pk) continue;
    if (!names.has(pk)) names.set(pk, t.payee.trim());
    for (const x of t.splits?.length ? t.splits : [t]) {
      if (!x.category) continue;
      const k = categoryKey(x.group, x.category);
      if (!fromSet.has(k) && !intoSet.has(k)) continue;
      const m = byCat.get(k) ?? new Map<string, number>();
      m.set(pk, (m.get(pk) ?? 0) + 1);
      byCat.set(k, m);
    }
  }
  // how many of the categories you use each payee shows up in
  const spread = new Map<string, number>();
  for (const k of into) for (const pk of byCat.get(k)?.keys() ?? []) spread.set(pk, (spread.get(pk) ?? 0) + 1);
  const out: Record<string, PayeeMatch> = {};
  for (const k of from) {
    const mine = byCat.get(k);
    if (!mine) continue;
    const total = [...mine.values()].reduce((a, b) => a + b, 0);
    if (total < minTxns) continue;
    const score = new Map<string, number>();
    const hits = new Map<string, Map<string, number>>();
    for (const [pk, n] of mine) {
      const k2s = into.filter((k2) => k2 !== k && byCat.get(k2)?.has(pk));
      for (const k2 of k2s) {
        score.set(k2, (score.get(k2) ?? 0) + n / k2s.length);
        const h = hits.get(k2) ?? new Map<string, number>();
        h.set(pk, n);
        hits.set(k2, h);
      }
    }
    const ranked = [...score].sort((a, b) => b[1] - a[1]);
    const [best, second] = ranked;
    if (!best || best[1] / total < minShare || (second && second[1] * 2 > best[1])) continue;
    const h = [...hits.get(best[0])!].sort((a, b) => b[1] - a[1]);
    out[k] = { into: best[0], payees: h.slice(0, 3).map(([pk]) => names.get(pk) ?? pk), matched: h.reduce((a, [, n]) => a + n, 0), of: total };
  }
  return out;
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
  /** Per YNAB account added (not matched): its company and name here (default: YNAB's name, no company). */
  names?: Record<string, { company?: string; name: string }>;
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
    /**
     * Recent transactions YNAB hasn't approved yet: they come in held for you to review (review), not
     * counted in balances or the budget until you accept them, as in YNAB.
     */
    notApprovedInYnab: number;
    /** Categories that pay one of your loans (a mortgage's "PITI"), linked to it: counted from Debts, not again as spending. */
    debtCategoriesLinked: number;
    /** YNAB categories combined into another one (one category here for both). */
    categoriesCombined: number;
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

/**
 * The transactions YNAB's budget doesn't count yet (ones not approved in YNAB), from `from` through
 * `thisMonth`: for each category whose spending in the Register differs from the Plan file's, the newest
 * uncleared transactions (not split) that make up the difference exactly. None when nothing adds up.
 */
export function notCounted(d: YnabData, from: string, thisMonth: string, today?: string): YnabTxn[] {
  const out: YnabTxn[] = [];
  const cents = (n: number) => Math.round(n * 100);
  for (let m = from; m <= thisMonth; m = addMonthsTo(m, 1)) {
    const planned = new Map<string, number>();
    for (const a of d.assigned) if (a.month === m && a.activity !== undefined) planned.set(categoryKey(a.group, a.category), (planned.get(categoryKey(a.group, a.category)) ?? 0) + cents(a.activity));
    if (!planned.size) continue;
    const reg = new Map<string, number>();
    const single = new Map<string, YnabTxn[]>();
    for (const t of d.txns) {
      if (t.date.slice(0, 7) !== m || (today && t.date > today)) continue;
      for (const p of t.splits?.length ? t.splits : [t]) {
        if (!p.category) continue;
        const k = categoryKey(p.group, p.category);
        reg.set(k, (reg.get(k) ?? 0) + cents(p.amount));
      }
      if (!t.splits?.length && t.category && t.cleared === "uncleared") {
        const k = categoryKey(t.group, t.category);
        single.set(k, [...(single.get(k) ?? []), t]);
      }
    }
    for (const [k, want] of planned) {
      const diff = (reg.get(k) ?? 0) - want;
      if (!diff) continue;
      // newest first; a handful is plenty (these are the last few days' transactions), and keeps the search small
      const pool = (single.get(k) ?? []).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 16);
      // which of them add up to the difference: every reachable total, and how it was reached
      const reach = new Map<number, number[]>([[0, []]]);
      for (let i = 0; i < pool.length && !reach.has(diff); i++) {
        for (const [sum, used] of [...reach]) {
          const next = sum + cents(pool[i]!.amount);
          if (!reach.has(next)) reach.set(next, [...used, i]);
        }
      }
      const hit = reach.get(diff);
      if (hit?.length) out.push(...hit.map((i) => pool[i]!));
    }
  }
  return out;
}

/**
 * The transactions YNAB hasn't approved yet, last month and this one (through `today`): YNAB leaves them
 * out of its balances and its budget. The export doesn't say which they are, so: the ones its category
 * totals leave out (notCounted), and uncleared ones with no category in a budget account (an imported
 * charge nobody has looked at yet).
 */
export function heldInYnab(d: YnabData, thisMonth: string, today?: string): Set<YnabTxn> {
  const from = addMonthsTo(thisMonth, -1);
  const held = new Set(notCounted(d, from, thisMonth, today));
  const budget = new Set(d.txns.filter((t) => t.category || t.splits?.length).map((t) => t.account));
  for (const t of d.txns) {
    const m = t.date.slice(0, 7);
    if (m < from || m > thisMonth || (today && t.date > today)) continue;
    if (budget.has(t.account) && t.cleared === "uncleared" && !t.category && !t.splits?.length && !t.transferTo && !/^starting balance$/i.test(t.payee)) held.add(t);
  }
  return held;
}

/**
 * An account's transactions this month that count in the budget (filed under a category or Ready to
 * Assign, not transfers), through `today`: what leaving the account out takes out of the budget.
 */
export function budgetTxnsThisMonth(d: YnabData, account: string, thisMonth: string, today?: string): number {
  return d.txns.filter((t) => t.account === account && t.date.slice(0, 7) === thisMonth && !(today && t.date > today) && !t.transferTo && (t.splits?.length ? t.splits.some((s) => !!s.category) : !!t.category)).length;
}

/**
 * YNAB's Ready to Assign for `thisMonth`, worked out from its export: the money in your budget's cash
 * accounts today, less what's left in every category (card payments too), less what later months have,
 * plus this month's overspending paid in cash (YNAB takes that from next month). `include`: which YNAB
 * accounts count (the ones you brought in). Null without YNAB's Plan file.
 */
export function ynabReadyToAssign(d: YnabData, thisMonth: string, today: string, include: (account: string) => boolean = () => true): number | null {
  const rows = d.assigned.filter((a) => a.month === thisMonth && !isReady(a.group, a.category) && !/^internal master category$/i.test(a.group));
  if (!rows.length || rows.every((a) => a.available === undefined)) return null;
  const accts = ynabAccounts(d, today);
  const pending = heldInYnab(d, thisMonth, today);
  const cash = accts.filter((a) => a.kind === "cash" && include(a.name)).reduce((t, a) => t + a.balance, 0);
  const cards = new Set(accts.filter((a) => a.kind === "card").map((a) => a.name));
  let held = 0;
  let cashOver = 0;
  for (const a of rows) {
    const av = a.available ?? 0;
    if (av > 0) { held += av; continue; }
    if (av > -0.005 || CARD_GROUP.test(a.group)) continue;
    // the purchases that took it past $0 (in date order): the ones in cash are overspending in cash (they
    // come out of next month in YNAB); the ones on a card stay on the card
    const spending = d.txns
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.date.slice(0, 7) === thisMonth && t.date <= today && !pending.has(t))
      .flatMap(({ t, i }) => (t.splits?.length ? t.splits : [t]).filter((x) => x.group === a.group && x.category === a.category).map((x) => ({ date: t.date, i, account: t.account, amount: x.amount })));
    const spent = spending.reduce((x, y) => x - y.amount, 0);
    cashOver += overspentBy(av - (a.activity ?? -spent), spending).filter((x) => !cards.has(x.account)).reduce((x, y) => x + y.amount, 0);
  }
  const later = d.assigned.filter((a) => a.month > thisMonth && !isReady(a.group, a.category)).reduce((t, a) => t + a.assigned, 0);
  return Math.round((cash - held - later + cashOver) * 100) / 100;
}

/**
 * Like YNAB: a category's money for the month (`start`, what it had before any of it) goes to its
 * spending in date order, and what each purchase spent past $0 is overspending on that purchase's
 * account. A refund after that takes back the latest of it. `i`: the export's order (each day newest first).
 */
function overspentBy(start: number, spending: { date: string; i: number; account: string; amount: number }[]): { account: string; amount: number }[] {
  const sorted = [...spending].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : y.i - x.i));
  let left = start;
  const over: { account: string; amount: number }[] = [];
  for (const p of sorted) {
    left += p.amount;
    if (p.amount < 0) {
      if (left < 0) over.push({ account: p.account, amount: Math.min(-p.amount, -left) });
    } else
      for (let back = p.amount; back > 0 && over.length; ) {
        const last = over[over.length - 1]!;
        const n = Math.min(back, last.amount);
        last.amount -= n;
        back -= n;
        if (last.amount < 0.005) over.pop();
      }
    if (left > 0) over.length = 0;
  }
  return over;
}

/** Turn YNAB's data into the plan's categories, assignments, accounts and transactions. */
export function buildImport(input: PlanState, d: YnabData, o: ImportOptions): ImportResult {
  const plan = structuredClone(input);
  const summary = { accountsAdded: 0, accountsRemoved: 0, categoriesAdded: 0, categoriesUpdated: 0, categoriesRemoved: 0, categoriesSkipped: 0, categoriesHidden: 0, transactions: 0, transactionsMatched: 0, months: 0, needsCategoryFromYnab: 0, needsCategoryLeftOut: 0, notApprovedInYnab: 0, debtCategoriesLinked: 0, categoriesCombined: 0, olderWithoutCategory: 0, transfersOutside: 0 };
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
    const named = o.names?.[a.name];
    const name = named?.name.trim() || (named?.company?.trim() ? "" : a.name);
    const co = named?.company?.trim() ? { company: named.company.trim() } : {};
    if (a.kind === "cash") plan.accounts.push({ id, name, ...co, type: "cash", balance: a.balance });
    else if (a.kind === "invest") plan.accounts.push({ id, name, ...co, type: "taxable", balance: a.balance });
    else {
      const debt: Debt = { id, name, ...co, kind: a.kind === "card" ? "credit_card" : /mortgage/i.test(a.name) ? "mortgage" : /student/i.test(a.name) ? "student" : /auto|car/i.test(a.name) ? "car" : "other", balance: Math.max(0, -a.balance), apr: a.kind === "card" ? 0.24 : 0.06, minPayment: 0 };
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
  // YNAB keeps a payment line for every card, and hides the ones for cards you've closed: those are
  // named like the account, so they go together under Closed accounts (not among your categories)
  const accountNames = new Set(d.txns.map((t) => norm(t.account)));
  const combined: YnabCategory[] = [];
  for (const c of cats) {
    const k = categoryKey(c.group, c.name);
    const opts = o.categories[k] ?? { inRetirement: true, essential: true };
    const ch = o.categoryMap?.[k] ?? suggestCategory(plan, c);
    if (ch.action === "skip") { summary.categoriesSkipped++; continue; }
    if (ch.action === "combine") { combined.push(c); continue; }
    if (ch.action === "invest") {
      // money moved into an account: an investing category for it (not spending)
      const accountId = ch.account.startsWith("plan:") ? ch.account.slice(5) : idOf.get(ch.account.slice(5));
      if (!accountId) { summary.categoriesSkipped++; continue; }
      const id = idFor("cat", k);
      itemOf.set(k, id);
      plan.budget.push({ id, name: c.name, amount: o.amounts?.[k] ?? c.average, inRetirement: false, group: (o.categoryGroup?.[k] ?? groupFor(c.group)) || undefined, accountId });
      summary.categoriesAdded++;
      continue;
    }
    if (ch.action === "hidden") {
      const id = idFor("cat", k);
      itemOf.set(k, id);
      const closedAccount = YNAB_HIDDEN.test(c.group) && accountNames.has(norm(c.name));
      hiddenItems.push({ id, name: c.name, amount: 0, inRetirement: false, group: (o.categoryGroup?.[k] ?? (closedAccount ? CLOSED_ACCOUNTS_GROUP : groupFor(c.group))) || undefined, hidden: true });
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
    if (ch.action === "loan") {
      const debtId = ch.debt.startsWith("plan:") ? ch.debt.slice(5) : idOf.get(ch.debt.slice(5));
      const debt = plan.debts.find((x) => x.id === debtId);
      if (debt && !plan.budget.some((b) => b.paysDebt === debt.id)) {
        item.paysDebt = debt.id;
        // a loan the import adds has no payment yet: what you assigned to its category is it
        if (!(debt.minPayment > 0)) debt.minPayment = item.amount;
        summary.debtCategoriesLinked++;
      }
    }
    plan.budget.push(item);
    summary.categoriesAdded++;
  }
  plan.budget.push(...hiddenItems);
  // combined into another of YNAB's: one category here (its transactions and amounts join that one's)
  const rootOf = (k: string): string | undefined => {
    let at = k;
    for (let i = 0; i < 6; i++) {
      const ch = o.categoryMap?.[at];
      if (!ch || ch.action !== "combine") return at;
      at = ch.into;
    }
    return undefined;
  };
  for (const c of combined) {
    const k = categoryKey(c.group, c.name);
    const root = rootOf(k);
    const id = root ? itemOf.get(root) : undefined;
    if (!id) { summary.categoriesSkipped++; continue; }
    itemOf.set(k, id);
    const item = plan.budget.find((b) => b.id === id);
    if (item && !item.hidden) item.amount = Math.round((item.amount + (o.amounts?.[k] ?? c.average)) * 100) / 100;
    summary.categoriesCombined++;
  }
  // a category that pays one of your loans (a mortgage's PITI): linked to it, so it isn't counted twice
  summary.debtCategoriesLinked += linkDebtCategories(plan);
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

  // the budget starts this month, from YNAB's own numbers: each category starts with what it had left in
  // YNAB at the end of last month, and earlier months are history (their transactions come in, but YNAB's
  // own results for them are taken as they are, not worked out again here)
  const budgetFrom = o.thisMonth;
  if (!plan.budgetPlan) plan.budgetPlan = { start: budgetFrom, startCash: 0, months: {} };
  plan.budgetPlan.start = budgetFrom;
  // YNAB's budget replaces these months whole (this month, and later ones YNAB has amounts for): an amount
  // left on a line YNAB doesn't have (say a loan payment line budgeted here before the import, while YNAB
  // pays it from its own category) would count the same money twice.
  const lastYnab = d.assigned.reduce((m, a) => (a.assigned && a.month > m ? a.month : m), budgetFrom);
  for (let m = budgetFrom; m <= lastYnab; m = addMonthsTo(m, 1)) {
    const e = plan.budgetPlan.months[m];
    if (e?.assigned || e?.cardDebt) {
      const { assigned: _old, cardDebt: _oldDebt, ...rest } = e;
      plan.budgetPlan.months[m] = rest;
    }
  }
  const monthsTouched = new Set<string>();
  const setHere = new Set<string>();
  for (const a of d.assigned) {
    if (a.month < budgetFrom || !a.assigned) continue;
    const key = catOf(a.group, a.category);
    if (!key || key === "ready") continue;
    const e = (plan.budgetPlan.months[a.month] ??= {});
    // YNAB's amount replaces what was here; two of YNAB's into one category add up. A negative one is
    // money taken back out of the category, as in YNAB.
    const prev = setHere.has(a.month + "|" + key) ? (e.assigned?.[key] ?? 0) : 0;
    setHere.add(a.month + "|" + key);
    e.assigned = { ...(e.assigned ?? {}), [key]: Math.round((prev + a.assigned) * 100) / 100 };
    monthsTouched.add(a.month);
  }
  // what each category had left at the end of last month in YNAB. One that went over there: what went
  // over in cash comes out of this month's ready to assign (as in YNAB); what went over on a card stays
  // on the card (YNAB's payment line for it already shows that).
  const lastMonth = addMonthsTo(budgetFrom, -1);
  const opening: Record<string, number> = {};
  for (const a of d.assigned) {
    if (a.month !== lastMonth) continue;
    const key = catOf(a.group, a.category);
    if (!key || key === "ready") continue;
    const av = a.available ?? 0;
    if (av > 0.005) opening[key] = Math.round(((opening[key] ?? 0) + av) * 100) / 100;
    else if (av < -0.005 && !CARD_GROUP.test(a.group)) {
      const spending = d.txns
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.date.slice(0, 7) === lastMonth)
        .flatMap(({ t, i }) => (t.splits?.length ? t.splits : [t]).filter((x) => x.group === a.group && x.category === a.category).map((x) => ({ date: t.date, i, account: t.account, amount: x.amount })));
      const spent = spending.reduce((x, y) => x - y.amount, 0);
      const cash = overspentBy(av - (a.activity ?? -spent), spending).filter((x) => kindOf.get(x.account) !== "card").reduce((x, y) => x + y.amount, 0);
      if (cash >= 0.005) opening[key] = Math.round(((opening[key] ?? 0) - cash) * 100) / 100;
    }
  }
  if (Object.keys(opening).length) plan.budgetPlan.opening = opening;
  else delete plan.budgetPlan.opening;
  summary.months = monthsTouched.size;

  // transactions in budget accounts (cash and cards), each account starting with its balance then
  const txns: Txn[] = [];
  const now = Date.now();
  const budgetAccount = (name: string) => !!idOf.get(name) && (kindOf.get(name) === "cash" || kindOf.get(name) === "card");
  const before = new Map<string, number>();
  const seen = new Map<string, number>();
  const madeFrom = new Map<YnabTxn, Txn>();
  const held = heldInYnab(d, o.thisMonth, o.today);
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
    // not approved in YNAB yet: held for you to review (with YNAB's category, if it had one), not counted
    // until you accept it, as YNAB doesn't count it until it's approved
    if (held.has(t)) {
      tx.review = true;
      summary.notApprovedInYnab++;
    }
    // needs a category here: YNAB had none, or its category was left out
    const hadCategory = t.splits?.length ? t.splits.every((s) => !!s.category) : !!t.category;
    // a transfer to an account you left out (an old or closed one): still a transfer, not spending, so it
    // needs no category (it points at that account by name, since there's no account here for it)
    const outside = !!t.transferTo && !to && !tx.categoryId && !t.splits?.length;
    // (an account's starting balance never needs one)
    const missing = t.splits?.length ? tx.splits!.some((s) => !s.categoryId) : !tx.categoryId && !(to && toBudget) && !outside && !/^starting balance$/i.test(t.payee);
    if (outside) summary.transfersOutside++;
    if (missing && t.date < recentFrom) summary.olderWithoutCategory++;
    else if (missing && !tx.review) {
      if (hadCategory) summary.needsCategoryLeftOut++;
      else summary.needsCategoryFromYnab++;
    }
    madeFrom.set(t, tx);
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
  // The purchase that took the category past $0 holds the overspending (overspentBy).
  const cardIds = new Set([...idOf].filter(([n]) => kindOf.get(n) === "card").map(([, id]) => id));
  for (let m = budgetFrom; m <= o.thisMonth; m = addMonthsTo(m, 1)) {
    const debt: CardDebt[] = [];
    const done = new Set<string>();
    for (const a of d.assigned) {
      if (a.month !== m || (a.available ?? 0) > -0.005 || CARD_GROUP.test(a.group)) continue;
      const key = catOf(a.group, a.category);
      if (!key || key === "ready" || key.startsWith("debt:") || done.has(key)) continue;
      done.add(key);
      const spending = txns
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.date.slice(0, 7) === m && !t.review && !(o.today && t.date > o.today))
        .flatMap(({ t, i }) => (t.splits?.length ? t.splits : [{ categoryId: t.categoryId ?? "", amount: t.amount }]).filter((p) => p.categoryId === key).map((p) => ({ date: t.date, i, account: t.accountId, amount: p.amount })));
      const spent = spending.reduce((x, p) => x - p.amount, 0);
      const over = overspentBy(a.available! - (a.activity ?? -spent), spending);
      const byCard = new Map<string, number>();
      for (const x of over) if (cardIds.has(x.account)) byCard.set("debt:" + x.account, (byCard.get("debt:" + x.account) ?? 0) + x.amount);
      for (const [card, amount] of byCard) if (amount >= 0.005) debt.push({ cat: key, card, amount: Math.round(amount * 100) / 100 });
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
