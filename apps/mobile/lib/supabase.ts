import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";

/**
 * Supabase client, or null when the app isn't configured for sync (it then works fully offline).
 * Only the public URL and anon key are in the app; row-level security protects the data.
 * The service-role key never goes in the app.
 */
/** How long one request may take (a batch of 500 transactions on slow Wi-Fi takes a few seconds). */
export const REQUEST_LIMIT = 40_000;

/** fetch, but giving up on a request after REQUEST_LIMIT (or when the caller cancels it). */
export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("The server took too long to answer.")), REQUEST_LIMIT);
  init?.signal?.addEventListener("abort", () => ctl.abort(init.signal?.reason));
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        // a request that hangs (a dropped connection) fails after a while instead of holding up sync
        global: { fetch: fetchWithTimeout },
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: Platform.OS === "web",
        },
      })
    : null;

export const syncConfigured = supabase !== null;
