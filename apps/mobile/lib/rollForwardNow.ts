import { rollForward } from "./rollForward";
import { monthKey, useStore } from "./store";

/**
 * Bring the saved plan up to today: run when the app opens and whenever it comes back to the front
 * (a change's month can arrive while the app sits open). Saves only when something moved.
 */
export function rollForwardNow(now = new Date()): void {
  const s = useStore.getState();
  if (!s.hydrated || !s.onboarded) return;
  const draft = structuredClone(s.plan);
  if (rollForward(draft, monthKey(now))) s.setPlan(draft);
}
