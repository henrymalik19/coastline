import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PlanState } from "@coastfi/engine";
import { importPrototypeJson, PlanStateSchema, samplePlanState, type Checkin } from "@coastfi/schema";
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
      todoDone: {},
      updatedAt: 0,
      hydrated: false,

      update: (fn) => {
        const draft = structuredClone(get().plan);
        fn(draft);
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
        const raw = JSON.parse(text) as unknown;
        // our own export wraps { plan, checkins }; anything else is treated as a prototype export
        if (raw && typeof raw === "object" && "plan" in raw && (raw as { app?: string }).app === "coastfi") {
          const r = raw as { plan: unknown; checkins?: Checkin[] };
          const plan = PlanStateSchema.parse(r.plan);
          set({ plan, checkins: r.checkins ?? [], onboarded: true, updatedAt: now() });
          return;
        }
        const { state, checkins } = importPrototypeJson(raw);
        set({ plan: state, checkins, onboarded: true, updatedAt: now() });
      },
      exportJson: () => {
        const { plan, checkins } = get();
        return JSON.stringify({ app: "coastfi", exportedAt: new Date().toISOString(), plan, checkins }, null, 2);
      },
      resetToSample: () => set({ plan: samplePlanState(), onboarded: false, updatedAt: now() }),
      startFresh: (plan) => set({ plan, onboarded: false, todoDone: {}, updatedAt: now() }),
    }),
    {
      name: "coastfi.app",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ plan, checkins, onboarded, todoDone, updatedAt }) => ({ plan, checkins, onboarded, todoDone, updatedAt }),
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
        };
      },
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
);

/** "YYYY-MM" for a date (check-ins and to-dos are keyed by month). */
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
