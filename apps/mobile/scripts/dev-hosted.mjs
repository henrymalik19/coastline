// Run the web app against the hosted Supabase project (values from .env.production).
// Usage: pnpm --filter @coastfi/mobile dev:hosted
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env.production", import.meta.url));
const env = { ...process.env };
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*(EXPO_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const port = process.argv[2] ?? "8082";
spawn("npx", ["expo", "start", "--web", "--clear", "--port", port], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env,
  stdio: "inherit",
  shell: true,
}).on("exit", (code) => process.exit(code ?? 0));
