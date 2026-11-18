/**
 * Reading and writing many rows: the server returns at most 1,000 rows per request (max_rows), and
 * one request with thousands of rows can be too big to send.
 */

/** Every row, a page at a time, until a page comes back short. Stops at the first error. */
export async function allPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  size = 1000,
  /** After each page: how many rows so far. */
  onPage?: (got: number) => void,
): Promise<{ data: T[]; error: unknown }> {
  const data: T[] = [];
  for (let from = 0; ; from += size) {
    const res = await page(from, from + size - 1);
    if (res.error) return { data, error: res.error };
    const rows = res.data ?? [];
    data.push(...rows);
    onPage?.(data.length);
    if (rows.length < size) return { data, error: null };
  }
}

/** The rows in batches of `size`, in order. */
export const batches = <T>(rows: T[], size: number): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

/**
 * Asking only for what changed: the server stamps each row with when it was last saved (a new row,
 * an edit, or a delete, which is an edit that marks it deleted). A device keeps the newest stamp it
 * has seen and next time asks for rows saved after it, minus a margin: a save that started earlier
 * can finish later, and getting a row twice is harmless.
 */
export const CHANGED_OVERLAP_MS = 5 * 60_000;

/**
 * A server stamp in ms. Postgres gives microseconds ("…39.319072+00:00", or with a space and "+00"),
 * which not every phone's date parser reads: cut it to a plain ISO time first. NaN when it isn't one.
 */
export function stampMs(s: string | null | undefined): number {
  if (!s) return NaN;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(s.trim());
  if (!m) return NaN;
  const ms = (m[3] ?? "").padEnd(3, "0").slice(0, 3);
  let zone = m[4] ?? "Z";
  if (zone !== "Z") zone = zone.length === 3 ? `${zone}:00` : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return Date.parse(`${m[1]}T${m[2]}.${ms}${zone}`);
}

/** Where to ask from, given the newest stamp this device has (none: ask for everything). */
export const changedSince = (cursor: string | undefined): string | undefined =>
  !Number.isNaN(stampMs(cursor)) ? new Date(stampMs(cursor) - CHANGED_OVERLAP_MS).toISOString() : undefined;

/** The newest of these server stamps and the one already held. */
export function newestStamp(stamps: (string | null | undefined)[], held?: string): string | undefined {
  let best = !Number.isNaN(stampMs(held)) ? held : undefined;
  for (const s of stamps) if (!Number.isNaN(stampMs(s)) && (!best || stampMs(s) > stampMs(best))) best = s!;
  return best;
}

/**
 * Where "uploaded up to" stands after taking in rows from the server. Rows that came from the server
 * don't need uploading back, so when this device has nothing of its own waiting to upload, it moves up
 * to the newest of them. With edits waiting, it stays (they go up next; resending a server row is harmless).
 */
export function pushedAfterPull(local: { updatedAt: number }[], pushed: number, pulled: { updatedAt: number }[]): number {
  if (local.some((t) => t.updatedAt > pushed)) return pushed;
  return pulled.reduce((m, t) => Math.max(m, t.updatedAt), pushed);
}
