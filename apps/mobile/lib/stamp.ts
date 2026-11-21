/**
 * Edit times. Each edit gets a time later than every edit this device has already seen, its own or
 * another device's. Devices' clocks differ: if a partner's phone runs 10 minutes fast, its edits carry
 * times 10 minutes ahead, and this device marks itself "uploaded up to" one of them. With plain clock
 * times, everything edited here in those 10 minutes would look already uploaded and never go up.
 */
let floor = 0;

/** A new edit time: now, or just after the latest edit time seen, whichever is later. */
export function stamp(): number {
  floor = Math.max(Date.now(), floor + 1);
  return floor;
}

/** Note edit times seen (from the account, other devices, or this device's saved copy). */
export function sawStamps(...times: number[]): void {
  for (const t of times) if (Number.isFinite(t) && t > floor) floor = t;
}
