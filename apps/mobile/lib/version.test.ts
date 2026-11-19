import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }) }, Platform: { OS: "web" } }));
const { isNewer, versionText } = await import("./version");

describe("version", () => {
  it("a different live commit is newer; the same one, a local build, or a bad file isn't", () => {
    expect(isNewer({ commit: "fa387ac" }, "6af5a20")).toBe(true);
    expect(isNewer({ commit: "6af5a20" }, "6af5a20")).toBe(false);
    expect(isNewer({ commit: "fa387ac" }, "dev")).toBe(false);
    expect(isNewer({ commit: "dev" }, "6af5a20")).toBe(false);
    expect(isNewer(null, "6af5a20")).toBe(false);
    expect(isNewer({ commit: 5 }, "6af5a20")).toBe(false);
  });
  it("says dev when run locally", () => {
    expect(versionText()).toBe("Version dev");
  });
});
