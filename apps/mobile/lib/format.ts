/** Display formatting only. All money math lives in @coastfi/engine. */

/**
 * Dollars, exact: cents shown when there are any ($2,345.67), none when it's whole ($2,345).
 * `whole`: round to dollars, for projections and estimates where cents would be false precision.
 * `compact`: $1.33M / $45k, only for tight spots like chart axes.
 */
export function money(v: number, opts: { compact?: boolean; whole?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (opts.compact && a >= 1e6) return `${v < 0 ? "−" : ""}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (opts.compact && a >= 1e4) return `${v < 0 ? "−" : ""}$${Math.round(a / 1e3)}k`;
  const cents = Math.round(a * 100);
  const wholeOnly = opts.whole || opts.compact || cents % 100 === 0;
  if (wholeOnly) {
    const d = Math.round(a);
    return `${v < 0 && d > 0 ? "−" : ""}$${d.toLocaleString("en-US")}`;
  }
  return `${v < 0 ? "−" : ""}$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const percent = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Label for month index `m` counted from `start`. */
export function monthLabel(start: Date, m: number, long = false): string {
  const a = start.getMonth() + m;
  const names = long ? MONTHS_LONG : MONTHS;
  return `${names[a % 12]} ${start.getFullYear() + Math.floor(a / 12)}`;
}

/** 41.25 → "41 yrs 3 mo" */
export function ageLabel(age: number): string {
  const y = Math.floor(age + 1e-9);
  const m = Math.round((age - y) * 12);
  return m ? `${y} yrs ${m} mo` : `${y}`;
}
