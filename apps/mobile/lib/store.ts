import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PlanState } from "@coastfi/engine";
import { CheckinSchema, PlanStateSchema, type Checkin } from "@coastfi/schema";
import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { freshPlan } from "./presets";

export { newId } from "./id";

/**
 * The user's plan + check-ins, saved on the device (AsyncStorage; localStorage on web).
 * Phase 3 adds sync on top of this; the store stays the single source of truth for the UI.
 */
export type AppState = {
  plan: PlanState;
  checkins: Checkin[];
  /** False until setup is finished; until then the app opens setup. */
  onboarded: boolean;
  /** Ticked to-dos per month: { "2026-11": ["debt", "ira"] } */
  todoDone: Record<string, string[]>;
  updatedAt: number;
  hydrated: boolean;

  /** Edit the plan with a mutating function on a copy. */
  update: (fn: (draft: PlanState) => void) => void;
  setPlan: (plan: PlanState) => void;
  toggleTodo: (month: string, key: string) => void;
  logCheckin: (c: Checkin) => void;
  completeOnboarding: () => void;
  /** Restore a backup made by this app. Throws a readable error. */
  importJson: (text: string) => void;
  exportJson: () => string;
  /** Clear the plan and go back through setup (check-ins are kept). */
  startFresh: () => void;
};

const now = () => Date.now();

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      plan: freshPlan(),
      checkins: [],
      onboarded: false,
      todoDone: {},
      updatedAt: 0,
      hydrated: false,

      update: (fn) => {
        const draft = structuredClone(get().plan);
        fn(draft);
        syncGoalSteps(draft);
        set({ plan: draft, updatedAt: now() });
      },
      setPlan: (plan) => set({ plan, updatedAt: now() }),
      toggleTodo: (month, key) => {
        const cur = get().todoDone[month] ?? [];
        const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
        set({ todoDone: { ...get().todoDone, [month]: next } });
      },
      logCheckin: (c) => {
        const rest = get().checkins.filter((x) => x.month !== c.month);
        set({ checkins: [...rest, c].sort((a, b) => a.month.localeCompare(b.month)), updatedAt: now() });
      },
      completeOnboarding: () => set({ onboarded: true, updatedAt: now() }),
      importJson: (text) => {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new Error("That isn't a Coastline backup file.");
        }
        const r = raw as { app?: string; plan?: unknown; checkins?: unknown };
        if (!r || typeof r !== "object" || r.app !== "coastfi" || !r.plan) throw new Error("That isn't a Coastline backup file.");
        const plan = PlanStateSchema.safeParse(r.plan);
        if (!plan.success) throw new Error("The backup is damaged or from an incompatible version.");
        const checkins = z.array(CheckinSchema).safeParse(r.checkins ?? []);
        set({ plan: plan.data, checkins: checkins.success ? checkins.data : [], onboarded: true, updatedAt: now() });
      },
      exportJson: () => {
        const { plan, checkins } = get();
        return JSON.stringify({ app: "coastfi", exportedAt: new Date().toISOString(), plan, checkins }, null, 2);
      },
      startFresh: () => set({ plan: freshPlan(), onboarded: false, todoDone: {}, updatedAt: now() }),
    }),
    {
      name: "coastfi.app",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ plan, checkins, onboarded, todoDone, updatedAt }) => ({ plan, checkins, onboarded, todoDone, updatedAt }),
      // never trust stored data blindly: validate, and fall back to a blank plan
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState> & { isSampleData?: boolean; seenWelcome?: boolean };
        const ok = PlanStateSchema.safeParse(p.plan);
        // saves from before the sample plan was removed: an untouched sample becomes a blank plan
        const wasSample = !p.onboarded && (p.isSampleData === true || (p.isSampleData === undefined && !p.seenWelcome));
        return {
          ...current,
          plan: ok.success && !wasSample ? ok.data : current.plan,
          onboarded: !!p.onboarded,
          checkins: Array.isArray(p.checkins) ? p.checkins : [],
          todoDone: p.todoDone && typeof p.todoDone === "object" ? p.todoDone : {},
          updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
        };
      },
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
);

/** Every goal has exactly one plan step; new goals go just before "taxable" (as in the prototype). */
export function syncGoalSteps(p: PlanState): void {
  const ids = p.goals.map((g) => `goal:${g.id}` as const);
  const steps = p.plan.steps.filter((s) => !s.startsWith("goal:") || ids.includes(s as `goal:${string}`));
  for (const id of ids) {
    if (steps.includes(id)) continue;
    const t = steps.indexOf("taxable");
    steps.splice(t < 0 ? steps.length : t, 0, id);
  }
  p.plan.steps = steps;
}

/** "YYYY-MM" for a date (check-ins and to-dos are keyed by month). */
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
