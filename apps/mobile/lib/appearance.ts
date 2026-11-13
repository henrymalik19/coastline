import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * How the app looks on this device: light / dark, and what the Budget shows. Kept on this device
 * only (not synced): a phone and a laptop can differ.
 */
export type Appearance = "system" | "light" | "dark";

export const useAppearance = create<{
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  /** Budget: compare categories with what you really spend (the line under Unassigned, ~$X on rows). */
  realSpending: boolean;
  setRealSpending: (on: boolean) => void;
}>()(
  persist(
    (set) => ({
      appearance: "system",
      setAppearance: (appearance) => set({ appearance }),
      realSpending: true,
      setRealSpending: (realSpending) => set({ realSpending }),
    }),
    { name: "coastline.appearance", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
