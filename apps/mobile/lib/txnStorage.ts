/**
 * Where the app's saved copy lives on the device.
 *
 * On the web: the plan and everything else small in one entry of localStorage (~5 MB for the whole
 * site), and every transaction in the browser's database (IndexedDB, which allows far more), one row
 * per transaction, so a change writes only the rows it touched (rowStorage).
 *
 * Elsewhere (phones' apps), or when the browser's database won't open: one entry (AsyncStorage), with
 * history (closed accounts' old transactions, see isHistoryTxn) kept in an entry of its own (splitStorage).
 *
 * A save that fails (storage full, private browsing) is reported (saveHealth), so the app can say so
 * instead of losing changes quietly. In memory nothing changes: the store holds every transaction.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isHistoryTxn, type Txn } from "@coastfi/engine";
import type { PersistStorage, StorageValue } from "zustand/middleware";

/** A place to keep a value (the history list). */
export type Shelf = { get: () => Promise<unknown>; set: (v: unknown) => Promise<void> };
/** A place for text (the everyday entry). */
export type TextStore = { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void>; removeItem: (k: string) => Promise<void> };

type WithTxns = { txns?: Txn[] };

/* ---------- whether saving works ---------- */

/** Why saves are failing ("full": out of room), while they are; cleared by the next save that works. */
export const saveHealth = (() => {
  let error: "full" | "failed" | undefined;
  const subs = new Set<() => void>();
  return {
    get: () => error,
    set: (e: "full" | "failed" | undefined) => {
      if (e === error) return;
      error = e;
      subs.forEach((f) => f());
    },
    subscribe: (f: () => void) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
})();
const why = (e: unknown): "full" | "failed" => {
  const name = (e as { name?: string } | null)?.name ?? "";
  return /quota/i.test(name) || /quota|full|space/i.test(String((e as Error | null)?.message ?? e)) ? "full" : "failed";
};

/** Saves one at a time: while one is written only the newest waiting value is kept. Outcomes go to saveHealth. */
function coalesce<S>(write: (v: StorageValue<S>) => Promise<void>) {
  let pending: StorageValue<S> | undefined;
  let running: Promise<void> | undefined;
  const drain = async () => {
    while (pending) {
      const v = pending;
      pending = undefined;
      try {
        await write(v);
        saveHealth.set(undefined);
      } catch (e) {
        // a failed save (storage full, private browsing): said on screen; the next change tries again
        saveHealth.set(why(e));
      }
    }
    running = undefined;
  };
  return (value: StorageValue<S>) => {
    pending = value;
    if (!running) running = drain();
    return running;
  };
}

/* ---------- history apart (phones, or no browser database) ---------- */

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
    setItem: (() => {
      const save = coalesce<S>(write);
      return (_key: string, value: StorageValue<S>) => save(value);
    })(),
    removeItem: async (key) => {
      await shelf.set([]);
      savedSig = historySig([]);
      await text.removeItem(key);
    },
  };
}

/* ---------- every transaction in its own row (the web) ---------- */

/** Transactions kept one row each, by id (the browser's database). */
export type Rows = { all: () => Promise<Txn[]>; write: (put: Txn[], del: string[]) => Promise<void>; clear: () => Promise<void> };

/** The newest copy of each id (by edit time; a tie keeps the earlier list's). */
function newest(...lists: Txn[][]): Txn[] {
  const by = new Map<string, Txn>();
  for (const l of lists) for (const t of l) {
    const o = by.get(t.id);
    if (!o || t.updatedAt > o.updatedAt) by.set(t.id, t);
  }
  return [...by.values()];
}

/**
 * The store's saved copy with transactions in `rows` and everything else in `text` under `name`. A save
 * writes only the transactions that changed since the last one (a new copy of an id with a new edit time
 * or different content), then the rest. Transactions found in the text entry (saved before this, or while
 * the rows couldn't be written) and history on the old `legacy` shelf are read too, and move into rows.
 * If the rows can't be written, everything goes in the text entry, as before.
 */
export function rowStorage<S extends WithTxns>(name: string, text: TextStore, rows: Rows, legacy?: Shelf): PersistStorage<S> {
  /** What rows hold, as this device last wrote or read it. */
  const saved = new Map<string, Txn>();
  let legacyLeft = false;

  const write = async (value: StorageValue<S>) => {
    const all = value.state.txns ?? [];
    const put: Txn[] = [];
    const keep = new Set<string>();
    for (const t of all) {
      keep.add(t.id);
      const o = saved.get(t.id);
      if (o === t) continue;
      if (!o || o.updatedAt !== t.updatedAt || JSON.stringify(o) !== JSON.stringify(t)) put.push(t);
      else saved.set(t.id, t); // the same, as a new copy: remembered, so it isn't compared again
    }
    const del = [...saved.keys()].filter((id) => !keep.has(id));
    let apart = true;
    if (put.length || del.length) {
      try {
        await rows.write(put, del);
        for (const t of put) saved.set(t.id, t);
        for (const id of del) saved.delete(id);
      } catch {
        apart = false; // the rows can't be written right now: everything in the text entry, as before
      }
    }
    await text.setItem(name, JSON.stringify({ ...value, state: { ...value.state, txns: apart ? [] : all } }));
    if (apart && legacyLeft && legacy) {
      try {
        await legacy.set([]);
        legacyLeft = false;
      } catch {
        // tried again with the next save (it's only read, never trusted over rows)
      }
    }
  };

  return {
    getItem: async (key) => {
      const raw = await text.getItem(key);
      let fromRows: Txn[] = [];
      try {
        fromRows = await rows.all();
      } catch {
        // unreadable: as if empty (the account still has them, and sync brings them back)
      }
      let old: Txn[] = [];
      if (legacy) {
        try {
          const h = await legacy.get();
          if (Array.isArray(h)) old = h as Txn[];
        } catch {
          // as if empty
        }
      }
      legacyLeft = old.length > 0;
      saved.clear();
      for (const t of fromRows) saved.set(t.id, t);
      const v = raw ? (JSON.parse(raw) as StorageValue<S>) : undefined;
      const inEntry = v?.state.txns ?? [];
      const txns = inEntry.length || old.length ? newest(fromRows, inEntry, old) : fromRows;
      if (!v) return txns.length ? ({ state: { txns }, version: 1 } as unknown as StorageValue<S>) : null;
      return { ...v, state: { ...v.state, txns } };
    },
    setItem: (() => {
      const save = coalesce<S>(write);
      return (_key: string, value: StorageValue<S>) => save(value);
    })(),
    removeItem: async (key) => {
      await rows.clear();
      saved.clear();
      if (legacy) await legacy.set([]);
      legacyLeft = false;
      await text.removeItem(key);
    },
  };
}

/* ---------- the shelves ---------- */

const DB = "coastfi";
const STORE = "kv";
const KEY = "history";
const TXNS = "txns";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // 2 adds a row per transaction (TXNS); 1 had only the history list (in STORE), now read once and moved
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      if (!d.objectStoreNames.contains(TXNS)) d.createObjectStore(TXNS, { keyPath: "id" });
    };
    req.onsuccess = () => {
      // a newer version of the app (another tab) needs to upgrade: let it
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("The app is open in another tab with an older version"));
  });
}
let dbP: Promise<IDBDatabase> | undefined;
const db = () => (dbP ??= openDb().catch((e) => { dbP = undefined; throw e; }));

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** The browser's database (IndexedDB): the old history list. */
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
    const tx = d.transaction(STORE, "readwrite");
    if (Array.isArray(v) && !v.length) tx.objectStore(STORE).delete(KEY);
    else tx.objectStore(STORE).put(v, KEY);
    await done(tx);
  },
};

/** Transactions one row each in the browser's database. */
export const idbRows: Rows = {
  all: async () => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction(TXNS, "readonly").objectStore(TXNS).getAll();
      req.onsuccess = () => resolve(req.result as Txn[]);
      req.onerror = () => reject(req.error);
    });
  },
  write: async (put, del) => {
    const d = await db();
    const tx = d.transaction(TXNS, "readwrite");
    const st = tx.objectStore(TXNS);
    for (const t of put) st.put(t);
    for (const id of del) st.delete(id);
    await done(tx);
  },
  clear: async () => {
    const d = await db();
    const tx = d.transaction(TXNS, "readwrite");
    tx.objectStore(TXNS).clear();
    await done(tx);
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

/** Read as one list, emptied together (the old history list, wherever it was kept). */
const bothShelves = (a: Shelf, b: Shelf): Shelf => ({
  get: async () => {
    const [x, y] = await Promise.all([a.get().catch(() => []), b.get().catch(() => [])]);
    return [...(Array.isArray(x) ? x : []), ...(Array.isArray(y) ? y : [])];
  },
  set: async (v) => {
    await Promise.all([a.set(v), b.set(v)]);
  },
});

/**
 * The app's storage. The web: transactions in the browser's database, a row each (rowStorage). Phones, or
 * a browser whose database won't open (some private modes): one entry with history apart (splitStorage).
 */
export function appStorage<S extends WithTxns>(name: string): PersistStorage<S> {
  const historyEntry = textShelf(AsyncStorage, "coastfi.history");
  if (typeof indexedDB === "undefined") return splitStorage<S>(name, AsyncStorage, historyEntry);
  let use: Promise<PersistStorage<S>> | undefined;
  const pick = () =>
    (use ??= db().then(
      // the old history list could be in either place (its own entry if the database once failed to open)
      () => rowStorage<S>(name, AsyncStorage, idbRows, bothShelves(idbShelf, historyEntry)),
      () => splitStorage<S>(name, AsyncStorage, historyEntry),
    ));
  return {
    getItem: async (k) => (await pick()).getItem(k),
    setItem: async (k, v) => (await pick()).setItem(k, v),
    removeItem: async (k) => (await pick()).removeItem(k),
  };
}
