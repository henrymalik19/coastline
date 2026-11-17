/**
 * The plan runs in today's dollars with real (after-inflation) returns. These only translate its
 * numbers for display, for people used to seeing returns and balances before inflation. Nothing in
 * the projection uses them.
 */

/** The inflation rate used to show "before inflation" and future-dollar figures. */
export const DISPLAY_INFLATION = 0.03;

/** A real (after-inflation) yearly return as the equivalent return before inflation. */
export function nominalReturn(real: number, inflation = DISPLAY_INFLATION): number {
  return (1 + real) * (1 + inflation) - 1;
}

/** An amount in today's dollars as dollars `years` from now, after inflation. */
export function inFutureDollars(amount: number, years: number, inflation = DISPLAY_INFLATION): number {
  return amount * (1 + inflation) ** Math.max(0, years);
}
