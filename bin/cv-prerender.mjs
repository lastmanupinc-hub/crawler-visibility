#!/usr/bin/env node
/**
 * cv-prerender — render a built SPA's routes into real crawlable HTML.
 *
 *   npx cv-prerender dist --routes seo.routes.ts
 *
 * Serves dist/ locally, then drives an already-installed Chrome/Edge with
 * --headless --dump-dom to capture each route's fully rendered DOM, and writes
 * the markup back into that route's HTML file.
 *
 * Why a real browser rather than renderToString or a DOM shim: these apps use a
 * custom hash router, read localStorage during render, and code-split heavily.
 * SSR crashes on the browser APIs and lightweight DOMs can't execute the split
 * module graph. Chrome handles all of it with zero changes to app code.
 *
 * It captures the app's OWN markup — nothing injected, fabricated, or hidden.
 * This is what a user sees, made readable by crawlers that don't run JS.
 */
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const args = process.argv.slice(2);
const distDir = args[0];
const routesArg = args.includes("--routes") ? args[args.indexOf("--routes") + 1] : undefined;
const budget = args.includes("--wait") ? Number(args[args.indexOf("--wait") + 1]) : 5000;
const minChars = args.includes("--min") ? Number(args[args.indexOf("--min") + 1]) : 200;

if (!distDir || !routesArg || distDir.startsWith("--")) {
  console.error("usage: cv-prerender <dist> --routes <file> [--wait ms] [--min chars]");
  process.exit(2);
}

const BROWSERS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) { console.error("No Chrome/Edge found. Set CHROME_PATH."); process.exit(2); }

let routes;
const routesPath = resolve(routesArg);
if (/\.tsx?$/.test(routesPath)) {
  const src = readFileSync(routesPath, "utf8");
  routes = [...src.matchAll(/path:\s*["'`]([^"'`]+)["'`]/g)].map((m) => ({ path: m[1] }));
} else {
  const mod = await import(pathToFileURL(routesPath).href);
  routes = mod.seoRoutes ?? mod.routes ?? mod.default;
}
if (!routes?.length) { console.error("no routes in", routesArg); process.exit(2); }

const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg",
  ".webp":"image/webp", ".ico":"image/x-icon", ".woff2":"font/woff2", ".woff":"font/woff", ".txt":"text/plain" };

const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  let file = join(distDir, p);
  try { if (statSync(file).isDirectory()) file = join(file, "index.html"); } catch {}
  if (!existsSync(file)) file = join(distDir, "index.html");
  try {
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), "cv-prerender-"));

let ok = 0, failed = 0;
for (const route of routes) {
  const clean = route.path.replace(/^\/+|\/+$/g, "");
  const file = clean ? join(distDir, clean, "index.html") : join(distDir, "index.html");
  if (!existsSync(file)) { console.log(`SKIP  ${route.path} (run the crawlerVisibility vite plugin first)`); continue; }

  try {
    const { stdout } = await run(browser, [
      "--headless", "--disable-gpu", "--no-sandbox", "--disable-extensions", "--no-first-run",
      `--user-data-dir=${profile}`, `--virtual-time-budget=${budget}`, "--dump-dom",
      base + route.path,
    ], { maxBuffer: 64 * 1024 * 1024, timeout: budget + 25000, windowsHide: true });

    const rootMatch = stdout.match(/<div id="root"[^>]*>([\s\S]*?)<\/div>\s*(?:<script|<\/body)/i);
    const rendered = rootMatch ? rootMatch[1] : "";
    const text = rendered.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    if (text.length < minChars) { console.log(`FAIL  ${route.path} — ${text.length} chars`); failed++; continue; }

    const html = readFileSync(file, "utf8");
    const out = html.replace(/(<div id="root">)([\s\S]*?)(<\/div>)/, (_m, a, _b, c) => `${a}${rendered}${c}`);
    writeFileSync(file, out, "utf8");
    console.log(`OK    ${route.path} — ${text.length} chars`);
    ok++;
  } catch (e) {
    console.log(`FAIL  ${route.path} — ${String(e.message).split("\n")[0].slice(0, 110)}`);
    failed++;
  }
}

server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(`\nprerendered ${ok}/${ok + failed}`);
process.exit(failed && ok === 0 ? 1 : 0);
