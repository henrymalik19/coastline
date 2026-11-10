import { defineConfig } from "vitest/config";

// The property tests run hundreds of random plans each; a busy CI machine can take more than vitest's default 5s.
export default defineConfig({ test: { testTimeout: 30_000 } });
