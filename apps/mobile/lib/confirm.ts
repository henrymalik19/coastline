import { Alert, Platform } from "react-native";
import { create } from "zustand";

/** The "are you sure?" waiting for an answer (shown by ConfirmHost), if any. */
export type PendingConfirm = { title: string; message: string; action: string; resolve: (ok: boolean) => void };
export const useConfirm = create<{ pending: PendingConfirm | null }>(() => ({ pending: null }));

/**
 * Cross-platform "are you sure?" for destructive actions. On the web it's a dialog in the app
 * (browser pop-ups can be blocked, and look out of place); on phones, the system's own.
 */
export function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      // a new question replaces one still open (that one counts as cancelled)
      useConfirm.getState().pending?.resolve(false);
      useConfirm.setState({ pending: { title, message, action, resolve } });
    });
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

/** Answer the open question (from the dialog's buttons). */
export function answerConfirm(ok: boolean): void {
  const p = useConfirm.getState().pending;
  if (!p) return;
  useConfirm.setState({ pending: null });
  p.resolve(ok);
}
