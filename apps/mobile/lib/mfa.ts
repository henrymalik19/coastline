import { supabase } from "./supabase";

/**
 * Two-step sign-in with an authenticator app (TOTP), optional. Once it's on, the emailed code alone
 * isn't enough: the database and the bank function refuse a sign-in until the app's code is entered.
 */

function client() {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  return supabase;
}

/** This sign-in still needs the authenticator code (the account has one, and it hasn't been entered). */
export async function needsSecondStep(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

/** The authenticator app set up on this account, if any. */
export async function authenticatorApp(): Promise<{ id: string } | undefined> {
  const { data, error } = await client().auth.mfa.listFactors();
  if (error) throw error;
  return data.totp[0];
}

/** Finish signing in with the 6-digit code from the authenticator app. */
export async function verifySecondStep(code: string) {
  const app = await authenticatorApp();
  if (!app) throw new Error("This account has no authenticator app. Sign in again.");
  const { error } = await client().auth.mfa.challengeAndVerify({ factorId: app.id, code });
  if (error) throw new Error(wrongCode(error.message));
}

export type Enrolling = { factorId: string; qr: string; secret: string; uri: string };

/** Start adding an authenticator app: a QR code and key to put into it. */
export async function startAuthenticator(): Promise<Enrolling> {
  const sb = client();
  // a setup that was never finished blocks a new one: clear it first
  const { data: all } = await sb.auth.mfa.listFactors();
  for (const f of all?.all ?? []) if (f.factor_type === "totp" && f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app", issuer: "Coastwise" });
  if (error) throw error;
  return { factorId: data.id, qr: svgDataUri(data.totp.qr_code), secret: data.totp.secret, uri: data.totp.uri };
}

/** Turn it on: the app's first code proves it's set up right. */
export async function finishAuthenticator(factorId: string, code: string) {
  const { error } = await client().auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw new Error(wrongCode(error.message));
}

/** Drop a setup that wasn't finished, or turn two-step sign-in off. */
export async function removeAuthenticator(factorId: string) {
  const { error } = await client().auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** Supabase gives the QR code as an unescaped SVG data URI; escape it so an <img> can show it. */
function svgDataUri(qr: string): string {
  const i = qr.indexOf("<svg");
  return i < 0 ? qr : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.slice(i))}`;
}

function wrongCode(message: string): string {
  return /invalid|expired/i.test(message) ? "That code didn't work. Check the time on your phone and try the newest code." : message;
}
