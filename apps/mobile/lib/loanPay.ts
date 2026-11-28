import type { Debt } from "@coastfi/engine";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The loan's yearly rate in a month ("YYYY-MM"): its promo rate through `promoUntil`, then its APR. */
export const loanRate = (d: Pick<Debt, "apr" | "promoApr" | "promoUntil">, month: string) =>
  d.promoApr !== undefined && d.promoUntil && month <= d.promoUntil ? d.promoApr : d.apr;

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
  for (const p of [...payments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
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
