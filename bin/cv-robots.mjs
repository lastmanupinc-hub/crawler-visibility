#!/usr/bin/env node
/**
 * cv-robots: print a robots.txt with explicit AI-crawler rules.
 *   cv-robots --site https://example.com [--ai allow-all|search-only|block-all] [--disallow /app/,/api/] [--no-sitemap]
 *   cv-robots --check robots.txt          report which AI crawlers an existing file names
 */
import { readFileSync, existsSync } from "node:fs";
import { buildRobots, parseRobots } from "../dist/robots.js";
const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : undefined; };
const fail = (m) => { console.error(`cv-robots: ${m}`); process.exit(2); };
if (argv.includes("-h") || argv.includes("--help") || !argv.length) {
  console.log("usage: cv-robots --site <url> [--ai allow-all|search-only|block-all] [--disallow /a/,/b/] [--no-sitemap]\n       cv-robots --check <robots.txt>");
  process.exit(argv.length ? 0 : 2);
}
const check = flag("--check");
if (check) {
  if (!existsSync(check)) fail(`no such file: ${check}`);
  const r = parseRobots(readFileSync(check, "utf8"));
  console.log(`AI crawlers named: ${r.aiRules.join(", ") || "none"}\nblocks all agents: ${r.disallowAll}\nsitemaps: ${r.sitemaps.join(", ") || "none"}`);
  process.exit(r.aiRules.length && !r.disallowAll ? 0 : 1);
}
const site = flag("--site"); if (!site) fail("--site <url> is required");
try { new URL(site); } catch { fail(`--site is not a URL: ${site}`); }
try {
  process.stdout.write(buildRobots({ siteUrl: site, ai: flag("--ai") ?? "allow-all", disallow: (flag("--disallow") ?? "").split(",").filter(Boolean), sitemap: argv.includes("--no-sitemap") ? false : undefined }));
} catch (e) { fail(e.message.replace(/^robots: /, "")); }
