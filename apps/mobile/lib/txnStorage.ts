/**
 * Where the app's saved copy lives on the device.
 *
 * Everyday data (the plan, check-ins, your current transactions) is one entry in the app's storage
 * (AsyncStorage; localStorage on the web), rewritten on every change. History (the old transactions of
 * closed accounts from YNAB, see isHistoryTxn) is kept apart: thousands of transactions that almost
 * never change shouldn't be rewritten with every edit, nor fill the web's ~5 MB storage. On the web it
 * goes in the browser's database (IndexedDB), which allows far more; elsewhere, its own storage entry.
 *
 * In memory nothing changes: the store holds every transaction, history included.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isHistoryTxn, type Txn } from "@coastfi/engine";
import type { PersistStorage, StorageValue } from "zustand/middleware";

/** A place to keep a value (the history list). */
export type Shelf = { get: () => Promise<unknown>; set: (v: unknown) => Promise<void> };
/** A place for text (the everyday entry). */
export type TextStore = { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void>; removeItem: (k: string) => Promise<void> };

type WithTxns = { txns?: Txn[] };

/** Changes when the history list does (an edit always gives a transaction a new edit time). */
export const historySig = (h: Txn[]) => {
  let sum = 0;
  let max = 0;
  for (const t of h) {
    sum += t.updatedAt;
    if (t.updatedAt > max) max = t.updatedAt;
  }
  return `${h.length}:${sum}:${max}`;
};

/**
 * The store's saved copy, split in two: everyday data in `text` under `name`, history on `shelf`.
 * Saves are coalesced (only the newest waits while one is being written), and history is written
 * first and only when it changed, so moving it out of the everyday entry never loses it.
 */
export function splitStorage<S extends WithTxns>(name: string, text: TextStore, shelf: Shelf): PersistStorage<S> {
  let savedSig: string | undefined;
  let pending: StorageValue<S> | undefined;
  let running: Promise<void> | undefined;

  const write = async (value: StorageValue<S>) => {
    const all = value.state.txns ?? [];
    const history = all.filter(isHistoryTxn);
    const sig = historySig(history);
    let apart = true;
    if (sig !== savedSig) {
      try {
        await shelf.set(history);
        savedSig = sig;
      } catch {
        // history can't be kept apart right now: save it with everything else, as before
        apart = false;
      }
    }
    const everyday = history.length && apart ? all.filter((t) => !isHistoryTxn(t)) : all;
    await text.setItem(name, JSON.stringify({ ...value, state: { ...value.state, txns: everyday } }));
  };
  const drain = async () => {
    while (pending) {
      const v = pending;
      pending = undefined;
      try {
        await write(v);
      } catch {
        // a failed save (storage full, private browsing): the next change tries again
      }
    }
    running = undefined;
  };

  return {
    getItem: async (key) => {
      const raw = await text.getItem(key);
      let history: Txn[] = [];
      try {
        const h = await shelf.get();
        if (Array.isArray(h)) history = h as Txn[];
      } catch {
        // unreadable: as if empty (the account still has it, and sync brings it back)
      }
      savedSig = historySig(history);
      if (!raw) return history.length ? ({ state: { txns: history }, version: 1 } as unknown as StorageValue<S>) : null;
      const v = JSON.parse(raw) as StorageValue<S>;
      if (!history.length) return v;
      const have = new Set((v.state.txns ?? []).map((t) => t.id));
      return { ...v, state: { ...v.state, txns: [...(v.state.txns ?? []), ...history.filter((t) => !have.has(t.id))] } };
    },
    setItem: (_key, value) => {
      pending = value;
      if (!running) running = drain();
      return running;
    },
    removeItem: async (key) => {
      await shelf.set([]);
      savedSig = historySig([]);
      await text.removeItem(key);
    },
  };
}

/* ---------- the shelves ---------- */

const DB = "coastfi";
const STORE = "kv";
const KEY = "history";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let dbP: Promise<IDBDatabase> | undefined;
const db = () => (dbP ??= openDb().catch((e) => { dbP = undefined; throw e; }));

/** The browser's database (IndexedDB). */
export const idbShelf: Shelf = {
  get: async () => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  set: async (v) => {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(v, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};

/** Its own storage entry (phones' apps, or a browser without IndexedDB). */
export const textShelf = (text: TextStore, key: string): Shelf => ({
  get: async () => {
    const raw = await text.getItem(key);
    return raw ? JSON.parse(raw) : [];
  },
  set: async (v) => {
    if (Array.isArray(v) && !v.length) await text.removeItem(key);
    else await text.setItem(key, JSON.stringify(v));
  },
});

/** IndexedDB where the browser has it; if it fails to open (some private modes), its own entry. */
function deviceShelf(): Shelf {
  const fallback = textShelf(AsyncStorage, "coastfi.history");
  if (typeof indexedDB === "undefined") return fallback;
  let use: Shelf | undefined;
  const pick = async () => {
    if (use) return use;
    try {
      await db();
      use = idbShelf;
    } catch {
      use = fallback;
    }
    return use;
  };
  return { get: async () => (await pick()).get(), set: async (v) => (await pick()).set(v) };
}

/** The app's storage: everyday data in AsyncStorage, history on the device's shelf. */
export const appStorage = <S extends WithTxns>(name: string) => splitStorage<S>(name, AsyncStorage, deviceShelf());
