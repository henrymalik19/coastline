/**
 * Three-way merge for the synced plan (two people editing one plan).
 *
 * `base` is the copy both sides started from (the last one this device synced), `local` has this
 * device's edits and `remote` has the other person's. Each side's changes are kept, part by part:
 * fields of objects merge one by one, and lists of things with an `id` (accounts, debts, budget
 * lines…) merge item by item. When both sides changed the very same value, this device's edit wins.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** The identity of a list item: its `id` (or `year`, for contribution-limit rows). */
const idOf = (v: unknown): string | undefined => {
  if (!isObj(v)) return undefined;
  if (typeof v.id === "string" || typeof v.id === "number") return `id:${v.id}`;
  if (typeof v.year === "number") return `year:${v.year}`;
  return undefined;
};

const keyedList = (...lists: unknown[][]): boolean => {
  const all = lists.flat();
  return all.length > 0 && lists.every((l) => {
    const ids = l.map(idOf);
    return ids.every((x) => x !== undefined) && new Set(ids).size === ids.length;
  });
};

export function merge3<T>(base: unknown, local: T, remote: T): T {
  if (deepEqual(local, remote)) return local;
  if (deepEqual(base, local)) return remote;
  if (deepEqual(base, remote)) return local;
  if (isObj(local) && isObj(remote)) return mergeObj(isObj(base) ? base : {}, local, remote) as T;
  if (Array.isArray(local) && Array.isArray(remote)) {
    const b = Array.isArray(base) ? base : [];
    if (keyedList(b, local, remote)) return mergeList(b, local, remote) as T;
  }
  // the same value changed on both sides: this device's edit wins
  return local;
}

function mergeObj(base: Obj, local: Obj, remote: Obj): Obj {
  const out: Obj = {};
  const keys = [...new Set([...Object.keys(remote), ...Object.keys(local)])];
  for (const k of keys) {
    const inB = base[k] !== undefined;
    const inL = local[k] !== undefined;
    const inR = remote[k] !== undefined;
    if (!inL && !inR) continue;
    if (!inL) {
      // removed here; keep it only if the other side changed it (or added it)
      if (!inB || !deepEqual(base[k], remote[k])) out[k] = remote[k];
      continue;
    }
    if (!inR) {
      if (!inB || !deepEqual(base[k], local[k])) out[k] = local[k];
      continue;
    }
    out[k] = merge3(base[k], local[k], remote[k]);
  }
  return out;
}

function mergeList(base: unknown[], local: unknown[], remote: unknown[]): unknown[] {
  const map = (l: unknown[]) => new Map(l.map((x) => [idOf(x)!, x]));
  const bm = map(base);
  const lm = map(local);
  const rm = map(remote);
  const ids = (l: unknown[]) => l.map((x) => idOf(x)!);

  // order: the side that reordered wins (when only this device reordered, keep its order)
  const remoteOrderUnchanged = deepEqual(ids(remote).filter((id) => bm.has(id)), ids(base).filter((id) => rm.has(id)));
  const [lead, other] = remoteOrderUnchanged ? [local, remote] : [remote, local];
  const order = ids(lead);
  const otherIds = ids(other);
  otherIds.forEach((id, i) => {
    if (order.includes(id)) return;
    // added at the end on its side: at the end here too; otherwise after the item it followed
    if (!otherIds.slice(i + 1).some((x) => order.includes(x))) {
      order.push(id);
      return;
    }
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(otherIds[j]!);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, id);
  });

  const out: unknown[] = [];
  for (const id of order) {
    const b = bm.get(id);
    const l = lm.get(id);
    const r = rm.get(id);
    if (l !== undefined && r !== undefined) out.push(merge3(b, l, r));
    else if (l !== undefined) {
      // not on the other side: they removed it (drop it unless we changed it) or we added it
      if (b === undefined || !deepEqual(b, l)) out.push(l);
    } else if (r !== undefined) {
      if (b === undefined || !deepEqual(b, r)) out.push(r);
    }
  }
  return out;
}
