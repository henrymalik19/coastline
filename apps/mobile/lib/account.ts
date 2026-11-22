/**
 * Account actions: sign in (an emailed code or a password), set a password, sign out (this device or
 * the others), and delete the account. Kept apart from syncing (lib/sync.ts), which re-exports these.
 */
import { markSigningOut, useSync } from "./sync";
import { useStore } from "./store";
import { supabase } from "./supabase";

export async function sendCode(email: string) {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string) {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

export const MIN_PASSWORD = 10;

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  // signing in with a password means you know it: drop a "Forgot password?" started earlier
  useSync.setState({ choosingPassword: undefined });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return;
  // the same answer whether the email has an account or not, so it can't be used to find accounts
  if (/invalid login credentials/i.test(error.message))
    throw new Error("Wrong email or password. If you haven't set a password yet, email yourself a code instead.");
  throw error;
}

/** Set or change the password for the signed-in account. */
export async function setPassword(password: string) {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  const { error } = await supabase.auth.updateUser({ password });
  if (!error) return;
  const code = (error as { code?: string }).code;
  if (code === "same_password") throw new Error("That's already your password.");
  if (code === "weak_password") throw new Error("That password is too easy to guess. Try a longer one.");
  throw error;
}

/** Sign out every other device and browser; this one stays signed in. */
export async function signOutOthers() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) throw error;
}

/** Sign out. The plan stays on this device unless `forget` is true. */
export async function signOut(forget = false) {
  if (!supabase) return;
  markSigningOut();
  // this device only: other devices stay signed in (Account has "Sign out other devices" for those)
  await supabase.auth.signOut({ scope: "local" });
  if (forget) {
    useStore.getState().startFresh();
    // forgetting clears this device only: the account's import record and transactions aren't this
    // device's to change (startFresh marks transactions deleted, which signing back in would upload)
    useStore.setState({ importDirty: false, txns: [], checkins: [], syncBase: undefined, txnCursor: undefined, txnPushed: undefined, outbox: [] });
  }
}

/** Delete the account and all synced data. The copy on this device is kept unless `forget`. */
export async function deleteAccount(forget: boolean) {
  if (!supabase) return;
  // disconnect your banks at Plaid first (deleting the rows alone would leave Plaid's access, and its billing, running)
  const me = useSync.getState().userId;
  const banks = me ? await supabase.from("plaid_items").select("id").eq("plan_id", me).limit(1) : null;
  if (banks && !banks.error && banks.data.length) {
    const r = await supabase.functions.invoke("plaid", { body: { action: "remove_all", planId: me } });
    if (r.error) throw new Error("Couldn't disconnect your banks, so your account wasn't deleted. Try again in a moment.");
  }
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  await signOut(forget);
}
