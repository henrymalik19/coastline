/**
 * A budget category that's really money moved to one of your accounts ("Roth IRA" next to a "Fidelity
 * Roth IRA" account): as spending it would raise your retirement number and count the money twice.
 * Find the account it should be linked to.
 */
import { accountGroup, linkedAccount, type Account, type PlanState } from "@coastfi/engine";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Accounts a category can be linked to: the ones the plan adds to that aren't cash (an IRA, a brokerage, an HSA you fund yourself). */
export function linkableAccounts(s: PlanState): Account[] {
  return s.accounts.filter((a) => !!linkedAccount(s, { accountId: a.id }));
}

export function suggestedAccount(s: PlanState, itemName: string): Account | undefined {
  const n = norm(itemName);
  if (n.length < 3) return undefined;
  const list = linkableAccounts(s);
  // 1. the names overlap: "Roth IRA" ↔ "Fidelity Roth IRA"
  const byName = list.find((acc) => {
    const a = norm(acc.name);
    return a === n || (` ${a} `.includes(` ${n} `) && n.length >= 4) || (` ${n} `.includes(` ${a} `) && a.length >= 4);
  });
  if (byName) return byName;
  // 2. the kind of account: "IRA", "Brokerage", "HSA"
  const want = /\bira\b/.test(n) ? "ira" : /\bbrokerage\b|\binvest(ing|ments?)?\b/.test(n) ? "taxable" : /\bhsa\b/.test(n) ? "hsa" : null;
  if (!want) return undefined;
  const sameKind = list.filter((a) => accountGroup(a) === want);
  if (want === "ira") {
    // "Roth IRA" → the Roth one; "Traditional IRA" → the pre-tax one
    const roth = /\broth\b/.test(n);
    const trad = /\btraditional\b|\btrad\b/.test(n);
    return sameKind.find((a) => (roth ? a.type === "roth" : trad ? a.type === "pretax" : true)) ?? (roth || trad ? undefined : sameKind[0]);
  }
  return sameKind[0];
}
