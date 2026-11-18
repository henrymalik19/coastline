/**
 * The bank or company an account is with ("Chase"), kept apart from its name ("Sapphire") and shown
 * before it: "Chase · Sapphire". Plain text: suggestions come from the ones you already use.
 */
import type { PlanState } from "@coastfi/engine";

type Named = { name?: string; company?: string };

/** "Chase · Sapphire", or just the name (or `fallback`) without a company. */
export function fullName(x: Named, fallback = ""): string {
  const name = x.name?.trim() || fallback;
  const company = x.company?.trim();
  return company ? (name ? `${company} · ${name}` : company) : name;
}

/** Every company your accounts and debts use, A to Z (each spelled as it's first used). */
export function companiesIn(p: Pick<PlanState, "accounts" | "debts">): string[] {
  const seen = new Map<string, string>();
  for (const x of [...p.accounts, ...p.debts]) {
    const c = x.company?.trim();
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Companies that start with what's typed (not the one typed exactly), for suggestions. */
export function suggestCompanies(all: string[], typed: string): string[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  return all.filter((c) => c.toLowerCase().startsWith(q) && c.toLowerCase() !== q).slice(0, 4);
}

/** How many other accounts and debts use company `name` (any case), besides `id`. */
export function othersWith(p: Pick<PlanState, "accounts" | "debts">, name: string, id: string): number {
  const n = name.trim().toLowerCase();
  return n ? [...p.accounts, ...p.debts].filter((x) => x.id !== id && x.company?.trim().toLowerCase() === n).length : 0;
}

/** Rename a company on every account and debt that uses it. */
export function renameCompany(p: Pick<PlanState, "accounts" | "debts">, from: string, to: string): void {
  const f = from.trim().toLowerCase();
  const next = to.trim();
  if (!f) return;
  for (const x of [...p.accounts, ...p.debts]) {
    if (x.company?.trim().toLowerCase() !== f) continue;
    if (next) x.company = next;
    else delete x.company;
  }
}

const SPLIT = /^(.+?)\s+[-–—]\s+(.+)$/;
/**
 * Company and name from names like "Chase - Sapphire": split only where two or more names share the
 * part before the dash (so it's clearly a company). Others stay whole, with no company.
 */
export function splitCompanies(names: string[]): Record<string, { company?: string; name: string }> {
  const count = new Map<string, number>();
  for (const n of names) {
    const m = n.trim().match(SPLIT);
    if (m) count.set(m[1]!.trim().toLowerCase(), (count.get(m[1]!.trim().toLowerCase()) ?? 0) + 1);
  }
  const out: Record<string, { company?: string; name: string }> = {};
  for (const n of names) {
    const m = n.trim().match(SPLIT);
    out[n] = m && (count.get(m[1]!.trim().toLowerCase()) ?? 0) >= 2 ? { company: m[1]!.trim(), name: m[2]!.trim() } : { name: n.trim() };
  }
  return out;
}
