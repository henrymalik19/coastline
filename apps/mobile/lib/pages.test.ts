import { describe, expect, it } from "vitest";
import { allPages, batches, CHANGED_OVERLAP_MS, changedSince, newestStamp, pushedAfterPull, stampMs } from "./pages";

/** A server that, like Supabase, returns at most `cap` rows per request. */
const server = (rows: number[], cap: number, failAt?: number) => {
  const asked: [number, number][] = [];
  const page = async (from: number, to: number) => {
    asked.push([from, to]);
    if (failAt !== undefined && from >= failAt) return { data: null, error: new Error("network") };
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { page, asked };
};

describe("reading every row past the server's 1,000-row cap", () => {
  it("gets all 8,216 rows, not the first 1,000", async () => {
    const rows = Array.from({ length: 8216 }, (_, i) => i);
    const s = server(rows, 1000);
    const r = await allPages(s.page);
    expect(r.error).toBeNull();
    expect(r.data).toEqual(rows);
    expect(s.asked).toHaveLength(9);
  });

  it("an exact multiple of the page size asks once more and stops on the empty page", async () => {
    const s = server(Array.from({ length: 2000 }, (_, i) => i), 1000);
    expect((await allPages(s.page)).data).toHaveLength(2000);
    expect(s.asked).toHaveLength(3);
  });

  it("a failed page is an error, not a short list", async () => {
    const r = await allPages(server(Array.from({ length: 3000 }, (_, i) => i), 1000, 1000).page);
    expect(r.error).toBeTruthy();
  });

  it("no rows", async () => {
    expect((await allPages(server([], 1000).page)).data).toEqual([]);
  });
});

describe("saving in batches", () => {
  it("splits in order and keeps every row", () => {
    const b = batches(Array.from({ length: 1201 }, (_, i) => i), 500);
    expect(b.map((x) => x.length)).toEqual([500, 500, 201]);
    expect(b.flat()).toHaveLength(1201);
    expect(batches([], 500)).toEqual([]);
  });
});

describe("asking only for what changed", () => {
  it("no marker yet: ask for everything", () => {
    expect(changedSince(undefined)).toBeUndefined();
    expect(changedSince("not a date")).toBeUndefined();
  });

  it("asks from a little before the newest save it has, so a save that finished late isn't missed", () => {
    const at = "2026-11-18T02:15:39.319Z";
    expect(Date.parse(changedSince(at)!)).toBe(Date.parse(at) - CHANGED_OVERLAP_MS);
  });

  it("keeps the newest stamp: an edit to a 2019 transaction today is today's stamp", () => {
    // Postgres sends stamps like this; the date of the transaction itself doesn't matter
    expect(newestStamp(["2026-11-18 00:24:14.1+00", "2026-11-18 02:15:39.319072+00", null], "2026-11-17T23:00:00Z")).toBe("2026-11-18 02:15:39.319072+00");
    expect(newestStamp([], "2026-11-17T23:00:00Z")).toBe("2026-11-17T23:00:00Z");
    expect(newestStamp([])).toBeUndefined();
  });
});

describe("reading the server's stamps", () => {
  it("microseconds, a space or a T, +00 or +00:00 or Z", () => {
    const ms = Date.UTC(2026, 10, 18, 2, 15, 39, 319);
    expect(stampMs("2026-11-18T02:15:39.319072+00:00")).toBe(ms);
    expect(stampMs("2026-11-18 02:15:39.319072+00")).toBe(ms);
    expect(stampMs("2026-11-18T02:15:39.319Z")).toBe(ms);
    expect(stampMs("2026-11-18T02:15:39+00:00")).toBe(ms - 319);
    expect(stampMs("2026-11-17T21:15:39.319-05:00")).toBe(ms);
    expect(stampMs("nope")).toBeNaN();
    expect(stampMs(undefined)).toBeNaN();
  });
});

describe("not uploading back what came from the server", () => {
  const at = (...n: number[]) => n.map((updatedAt) => ({ updatedAt }));
  it("nothing of this device's waiting: rows from the server count as uploaded", () => {
    expect(pushedAfterPull(at(5, 8), 10, at(3, 40))).toBe(40);
    expect(pushedAfterPull([], 0, at(1, 1, 1))).toBe(1);
  });
  it("an edit of this device's waiting: stays put, so the edit still goes up", () => {
    expect(pushedAfterPull(at(5, 12), 10, at(40))).toBe(10);
  });
  it("nothing pulled: unchanged", () => {
    expect(pushedAfterPull(at(5), 10, [])).toBe(10);
  });
});
