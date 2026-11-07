/**
 * A budget item that's really one of your accounts ("Roth IRA" next to "Fidelity Roth IRA"): the item
 * counts as spending, the account's line counts as investing. Find the account line it duplicates.
 */
import { accountGroup, type BudgetCategory, type PlanState } from "@coastfi/engine";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function duplicateOf(s: PlanState, itemName: string, cats: BudgetCategory[]): BudgetCategory | undefined {
  const n = norm(itemName);
  if (n.length < 3) return undefined;
  const lines = cats.filter((c) => c.kind === "saving" && c.key.startsWith("acct:"));
  // 1. the names overlap: "Roth IRA" ↔ "Fidelity Roth IRA", "Emergency Fund" ↔ "Emergency Fund"
  const byName = lines.find((c) => {
    const a = norm(c.name);
    return a === n || (` ${a} `.includes(` ${n} `) && n.length >= 4) || (` ${n} `.includes(` ${a} `) && a.length >= 4);
  });
  if (byName) return byName;
  // 2. the kind of account: "IRA", "Brokerage", "HSA", "Emergency fund"
  const kindOf = (c: BudgetCategory) => {
    const a = s.accounts.find((x) => "acct:" + x.id === c.key);
    return a ? { group: accountGroup(a), type: a.type } : undefined;
  };
  const want =
    /\bemergency\b|\bsavings? account\b/.test(n) ? "cash"
    : /\bira\b/.test(n) ? "ira"
    : /\bbrokerage\b|\binvest(ing|ments?)?\b/.test(n) ? "taxable"
    : /\bhsa\b/.test(n) ? "hsa"
    : null;
  if (!want) return undefined;
  const sameKind = lines.filter((c) => kindOf(c)?.group === want);
  if (want === "ira") {
    // "Roth IRA" → the Roth one; "Traditional IRA" → the pre-tax one
    const roth = /\broth\b/.test(n);
    const trad = /\btraditional\b|\btrad\b/.test(n);
    return sameKind.find((c) => (roth ? kindOf(c)?.type === "roth" : trad ? kindOf(c)?.type === "pretax" : true)) ?? (roth || trad ? undefined : sameKind[0]);
  }
  return sameKind[0];
}
