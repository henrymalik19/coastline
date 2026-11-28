import type { Debt } from "@coastfi/engine";
import { money } from "./format";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The loan's yearly rate in a month ("YYYY-MM"): its promo rate through `promoUntil`, then its APR. */
export const loanRate = (d: Pick<Debt, "apr" | "promoApr" | "promoUntil">, month: string) =>
  d.promoApr !== undefined && d.promoUntil && month <= d.promoUntil ? d.promoApr : d.apr;

/** A month's payments in the order they pay the interest: by date, then the bigger one (the regular payment) first. */
export const payOrder = (a: { date: string; amount: number; id: string }, b: { date: string; amount: number; id: string }) =>
  a.date.localeCompare(b.date) || b.amount - a.amount || a.id.localeCompare(b.id);

export type LoanPart = { interest: number; escrow: number; principal: number };

/**
 * What a month's payments to a loan do. The month's interest (on the balance before them) and its
 * escrow are paid once, by the first payments of the month in date order; the rest of each lowers the
 * balance. So an extra payment made as its own transaction, after the regular one, is all principal.
 */
export function splitLoanMonth(
  d: Pick<Debt, "apr" | "promoApr" | "promoUntil" | "escrow">,
  balanceBefore: number,
  month: string,
  payments: { id: string; date: string; amount: number }[],
): Map<string, LoanPart> {
  let interest = round2(Math.max(0, balanceBefore) * (loanRate(d, month) || 0) / 12);
  let escrow = round2(Math.max(0, d.escrow ?? 0));
  const out = new Map<string, LoanPart>();
  for (const p of [...payments].sort(payOrder)) {
    const pay = round2(p.amount);
    if (pay <= 0) {
      out.set(p.id, { interest: 0, escrow: 0, principal: pay });
      continue;
    }
    const toInterest = Math.min(pay, interest);
    const toEscrow = Math.min(round2(pay - toInterest), escrow);
    interest = round2(interest - toInterest);
    escrow = round2(escrow - toEscrow);
    out.set(p.id, { interest: round2(toInterest), escrow: round2(toEscrow), principal: round2(pay - toInterest - toEscrow) });
  }
  return out;
}

/**
 * Each payment to a loan, as its Activity shows it: its interest, escrow and principal (what it lowered
 * the balance by, as saved), worked out as when it was saved, and what was owed after it (back from
 * today's balance). One that never moved the balance (brought in from YNAB) says so.
 */
export function loanHistory(
  d: Pick<Debt, "id" | "balance" | "escrow" | "apr" | "promoApr" | "promoUntil" | "payroll">,
  txns: { id: string; date: string; amount: number; deleted?: boolean; transferAccountId?: string; trackedAmount?: number }[],
): Map<string, { note: string; after: number }> {
  const pays = txns
    .filter((t) => !t.deleted && t.transferAccountId === d.id && t.amount < 0)
    .map((t) => ({ id: t.id, date: t.date, amount: round2(-t.amount), principal: t.trackedAmount }));
  const months = [...new Set(pays.map((p) => p.date.slice(0, 7)))].sort().reverse();
  const out = new Map<string, { note: string; after: number }>();
  let after = round2(Math.max(0, d.balance));
  for (const month of months) {
    const these = pays.filter((p) => p.date.startsWith(month)).sort(payOrder);
    const counted = these.filter((p) => p.principal !== undefined);
    const before = round2(after + counted.reduce((sum, p) => sum + (p.principal ?? 0), 0));
    const split = splitLoanMonth(d, before, month, counted);
    // newest first: each one's "owed after" walks back up
    let owed = after;
    for (const p of [...these].reverse()) {
      let note: string;
      if (p.principal === undefined) note = "Not counted in the balance";
      // a 401(k) loan: your paycheck pays the interest, so one you add is all principal
      else if (d.payroll) note = "Extra: all principal";
      else {
        const part = split.get(p.id)!;
        const first = counted[0]?.id === p.id;
        note =
          part.interest + part.escrow < 0.005
            ? first
              ? "All principal"
              : "Extra: all principal"
            : [part.interest > 0.005 ? `${money(part.interest)} interest` : "", part.escrow > 0.005 ? `${money(part.escrow)} escrow` : "", `${money(round2(p.principal))} principal`]
                .filter(Boolean)
                .join(" · ");
      }
      out.set(p.id, { note, after: owed });
      owed = round2(owed + (p.principal ?? 0));
    }
    after = before;
  }
  return out;
}
