import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Light / dark preference. Kept on this device only (not synced): a phone and a laptop can differ. */
export type Appearance = "system" | "light" | "dark";

export const useAppearance = create<{ appearance: Appearance; setAppearance: (a: Appearance) => void }>()(
  persist(
    (set) => ({
      appearance: "system",
      setAppearance: (appearance) => set({ appearance }),
    }),
    { name: "coastline.appearance", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
