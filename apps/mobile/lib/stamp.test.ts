import { describe, expect, it, vi } from "vitest";
import { pushedAfterPull } from "./pages";
import { sawStamps, stamp } from "./stamp";

describe("edit times across devices with different clocks", () => {
  it("an edit made after taking in a fast-clock device's rows still counts as not uploaded", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    // the partner's phone is 10 minutes fast
    const theirs = [{ updatedAt: 1_000_000 + 600_000 }];
    const pushed = pushedAfterPull([], 0, theirs);
    sawStamps(...theirs.map((t) => t.updatedAt));
    vi.setSystemTime(1_000_000 + 60_000);
    const mine = stamp();
    // the upload sends edits newer than "uploaded up to"
    expect(mine).toBeGreaterThan(pushed);
    vi.useRealTimers();
  });
  it("is always increasing", () => {
    const a = stamp();
    const b = stamp();
    expect(b).toBeGreaterThan(a);
  });
});
