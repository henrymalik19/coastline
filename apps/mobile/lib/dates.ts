/** Date helpers for inputs. Dates are stored as ISO "YYYY-MM-DD" strings. */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
export const toISO = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Real calendar date? (rejects Feb 30 etc.) */
function valid(y: number, m: number, d: number): boolean {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/**
 * Parse what people actually type into an ISO date, or null.
 * Accepts 2026-11-20, 2026/11/20, 11/20/2026, 11-20-26, 11.20.2026, 11/20 (this year),
 * Nov 20 2026, November 20, 2026, Nov 20 (this year), 20 Nov 2026.
 */
export function parseDate(text: string, today: Date = new Date()): string | null {
  const s = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return null;
  let m: RegExpMatchArray | null;

  // year first: 2026-11-20, 2026/11/20
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    const [y, mo, d] = [+m[1]!, +m[2]!, +m[3]!];
    return valid(y, mo, d) ? toISO(y, mo, d) : null;
  }
  // US order: 11/20/2026, 11-20-26, 11.20.2026, or 11/20 (this year)
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/))) {
    const [mo, d] = [+m[1]!, +m[2]!];
    const y = m[3] ? fullYear(+m[3]) : today.getFullYear();
    return valid(y, mo, d) ? toISO(y, mo, d) : null;
  }
  // month name first: nov 20 2026, november 20, nov 20
  if ((m = s.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2}|\d{4}))?$/))) {
    const mo = MONTHS.indexOf(m[1]!.slice(0, 3)) + 1;
    const y = m[3] ? fullYear(+m[3]) : today.getFullYear();
    return mo && valid(y, mo, +m[2]!) ? toISO(y, mo, +m[2]!) : null;
  }
  // day first: 20 nov 2026
  if ((m = s.match(/^(\d{1,2}) ([a-z]+)\.?(?: (\d{2}|\d{4}))?$/))) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3)) + 1;
    const y = m[3] ? fullYear(+m[3]) : today.getFullYear();
    return mo && valid(y, mo, +m[1]!) ? toISO(y, mo, +m[1]!) : null;
  }
  return null;
}

/** "2026-11-20" → "Nov 20, 2026" */
export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return y && m && d ? `${SHORT[m - 1]} ${d}, ${y}` : iso;
}

/** Split an ISO date into numbers. */
export const isoParts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return { y, m, d };
};
