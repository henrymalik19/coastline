// End-to-end tests: build the web app with no account or sync (it runs fully offline, so tests never
// reach any server or anyone's data) and serve it on its own port, every path falling back to the app.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const out = join(app, "dist-e2e");
const port = Number(process.env.E2E_PORT ?? 8090);

if (process.env.E2E_SKIP_BUILD !== "1" || !existsSync(join(out, "index.html"))) {
  execSync(`npx expo export -p web --output-dir dist-e2e`, {
    cwd: app,
    stdio: "inherit",
    // empty values win over apps/mobile/.env: no Supabase (offline), no bank connections
    env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: "", EXPO_PUBLIC_SUPABASE_ANON_KEY: "", EXPO_PUBLIC_FF_BANKS: "", EXPO_PUBLIC_FF_BANKS_PUBLIC: "" },
  });
}

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png", ".ttf": "font/ttf", ".css": "text/css" };
createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  let file = join(out, path);
  if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) file = join(out, "index.html");
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log(`e2e app on http://127.0.0.1:${port}`));
