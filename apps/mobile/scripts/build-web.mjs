// Build the web app with its version baked in (the commit and when it was built), and write
// dist/version.json so an open app can tell a newer version is live (lib/version.ts).
// Vercel sets VERCEL_GIT_COMMIT_SHA; anywhere else the version is "dev".
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7);
const at = new Date().toISOString();
execSync("npx expo export -p web", { cwd, stdio: "inherit", env: { ...process.env, EXPO_PUBLIC_COMMIT: commit, EXPO_PUBLIC_BUILT_AT: at } });
writeFileSync(new URL("../dist/version.json", import.meta.url), JSON.stringify({ commit, at }));
console.log(`version ${commit} (${at})`);
