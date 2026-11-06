/** Display formatting only. All money math lives in @coastfi/engine. */

export function money(v: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < -0.5 ? "−" : "";
  if (opts.compact && a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (opts.compact && a >= 1e4) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
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
