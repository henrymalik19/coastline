import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PlanState } from "@coastfi/engine";
import { CheckinSchema, PlanStateSchema, samplePlanState, type Checkin } from "@coastfi/schema";
import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * The user's plan + check-ins, saved on the device (AsyncStorage; localStorage on web).
 * Phase 3 adds sync on top of this; the store stays the single source of truth for the UI.
 */
export type AppState = {
  plan: PlanState;
  checkins: Checkin[];
  /** False until onboarding is done; until then the sample plan is shown. */
  onboarded: boolean;
  /** The welcome screen has been shown once (so skipping it isn't nagged again). */
  seenWelcome: boolean;
  /** The plan is still the built-in sample (setup replaces it; re-entering setup keeps your entries). */
  isSampleData: boolean;
  markWelcomeSeen: () => void;
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
  /** Import JSON from this app or the prototype (v1/v2). Throws a readable error. */
  importJson: (text: string) => void;
  exportJson: () => string;
  resetToSample: () => void;
  startFresh: (plan: PlanState) => void;
};

const now = () => Date.now();

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      plan: samplePlanState(),
      checkins: [],
      onboarded: false,
      seenWelcome: false,
      isSampleData: true,
      markWelcomeSeen: () => set({ seenWelcome: true }),
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
          throw new Error("That isn't a Coast FI backup file.");
        }
        const r = raw as { app?: string; plan?: unknown; checkins?: unknown };
        if (!r || typeof r !== "object" || r.app !== "coastfi" || !r.plan) throw new Error("That isn't a Coast FI backup file.");
        const plan = PlanStateSchema.safeParse(r.plan);
        if (!plan.success) throw new Error("The backup is damaged or from an incompatible version.");
        const checkins = z.array(CheckinSchema).safeParse(r.checkins ?? []);
        set({ plan: plan.data, checkins: checkins.success ? checkins.data : [], onboarded: true, isSampleData: false, updatedAt: now() });
      },
      exportJson: () => {
        const { plan, checkins } = get();
        return JSON.stringify({ app: "coastfi", exportedAt: new Date().toISOString(), plan, checkins }, null, 2);
      },
      resetToSample: () => set({ plan: samplePlanState(), onboarded: false, isSampleData: true, updatedAt: now() }),
      startFresh: (plan) => set({ plan, onboarded: false, isSampleData: false, todoDone: {}, updatedAt: now() }),
    }),
    {
      name: "coastfi.app",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ plan, checkins, onboarded, seenWelcome, isSampleData, todoDone, updatedAt }) => ({ plan, checkins, onboarded, seenWelcome, isSampleData, todoDone, updatedAt }),
      // never trust stored data blindly: validate, and fall back to the sample plan
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const ok = PlanStateSchema.safeParse(p.plan);
        return {
          ...current,
          ...p,
          plan: ok.success ? ok.data : current.plan,
          checkins: Array.isArray(p.checkins) ? p.checkins : [],
          todoDone: p.todoDone && typeof p.todoDone === "object" ? p.todoDone : {},
          // older saves have no flag: only treat it as the sample if nothing has happened yet
          isSampleData: typeof p.isSampleData === "boolean" ? p.isSampleData : !p.onboarded && !p.seenWelcome,
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

export const newId = () => Math.random().toString(36).slice(2, 9);

/** "YYYY-MM" for a date (check-ins and to-dos are keyed by month). */
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
