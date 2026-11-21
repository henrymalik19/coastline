/**
 * Feature flags: build-time switches for things that aren't ready for everyone yet. Named
 * EXPO_PUBLIC_FF_<NAME>, so they stand apart from settings like the Supabase URL.
 * Set them in apps/mobile/.env locally, and in the host's environment variables for the live site
 * (Vercel: Settings → Environment Variables, then redeploy). Expo bakes EXPO_PUBLIC_* values in at
 * build time, so each must be read as process.env.EXPO_PUBLIC_FF_<NAME> literally.
 */

/**
 * Bank connections (Plaid): the "Connected banks" card and the automatic balance refresh.
 * Off unless EXPO_PUBLIC_FF_BANKS=on. Turn it on for the live site once the hosted tables and function are
 * set up with Production keys.
 */
export const BANKS_ON = process.env.EXPO_PUBLIC_FF_BANKS === "on";

/**
 * Telling everyone about bank connections (the landing page). Off unless EXPO_PUBLIC_FF_BANKS_PUBLIC=on:
 * while only admins and people on the server's list can connect banks, nobody else hears about it.
 */
export const BANKS_PUBLIC = BANKS_ON && process.env.EXPO_PUBLIC_FF_BANKS_PUBLIC === "on";
