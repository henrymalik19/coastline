import AsyncStorage from "@react-native-async-storage/async-storage";

/** A device that hasn't opened the app for this long gets signed out (its plan stays). */
export const AWAY_LIMIT_DAYS = 30;
const DAY = 86_400_000;
const KEY = "coastwise.lastActive";
/** Only note activity this often, so focusing the app doesn't write every time. */
const NOTE_EVERY = 3_600_000;

/** Whether a device last used at `last` has been away too long by `now` (never used: not away). */
export function awayTooLong(last: number | undefined, now: number, limitDays = AWAY_LIMIT_DAYS): boolean {
  return last !== undefined && Number.isFinite(last) && now - last > limitDays * DAY;
}

export async function lastActive(): Promise<number | undefined> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v ? Number(v) : undefined;
  } catch {
    return undefined;
  }
}

let noted = 0;
/** Note that the app is being used now. */
export function noteActive(now = Date.now()) {
  if (now - noted < NOTE_EVERY) return;
  noted = now;
  void AsyncStorage.setItem(KEY, String(now)).catch(() => undefined);
}
