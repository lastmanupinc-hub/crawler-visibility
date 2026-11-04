#!/usr/bin/env node
/**
 * cv-sitemap: build one sitemap.xml per host.
 *   cv-sitemap --site https://a.example.com /  /pricing  /docs        one host, paths as args
 *   cv-sitemap --urls urls.txt --out dir/                            many hosts: writes dir/<host>/sitemap.xml
 *   cv-sitemap --check sitemap.xml --host a.example.com              validate: shape, foreign hosts, duplicates
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { buildSitemap, buildSitemapsByHost, checkSitemap } from "../dist/sitemap.js";
const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : undefined; };
const fail = (m) => { console.error(`cv-sitemap: ${m}`); process.exit(2); };
const valued = new Set(["--site", "--urls", "--out", "--check", "--host"]);
const rest = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1]));
if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
  console.log("usage: cv-sitemap --site <url> <path...> | --urls <file> --out <dir> | --check <sitemap.xml> --host <host>");
  process.exit(argv.length ? 0 : 2);
}
try {
  if (flag("--check")) {
    const f = flag("--check"), host = flag("--host"); if (!host) fail("--check needs --host");
    if (!existsSync(f)) fail(`no such file: ${f}`);
    const r = checkSitemap(readFileSync(f, "utf8"), host);
    console.log(`${r.valid ? "VALID" : "INVALID"}  ${r.urls.length} URLs`); for (const p of r.problems) console.log(`  - ${p}`);
    process.exit(r.valid ? 0 : 1);
  } else if (flag("--urls")) {
    const out = flag("--out"); if (!out) fail("--urls needs --out <dir>");
    if (!existsSync(flag("--urls"))) fail(`no such file: ${flag("--urls")}`);
    const urls = readFileSync(flag("--urls"), "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
    const bad = urls.find((u) => { try { new URL(u); return !/^https?:$/.test(new URL(u).protocol); } catch { return true; } });
    if (bad) fail(`not an absolute http(s) URL in ${flag("--urls")}: ${JSON.stringify(bad)}`);
    if (!urls.length) fail(`no URLs in ${flag("--urls")}`);
    const root = resolve(out);
    for (const [host, xml] of Object.entries(buildSitemapsByHost(urls))) {
      const dirName = host.replace(/[^a-z0-9.-]/gi, "_"); // ports and IPv6 brackets become "_"
      const dir = resolve(root, dirName);
      if (dirName.startsWith(".") || !dir.startsWith(root + sep)) fail(`refusing to write outside ${out}: ${host}`);
      mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "sitemap.xml"), xml); console.log(`wrote ${join(out, dirName, "sitemap.xml")}`);
    }
  } else {
    const site = flag("--site"); if (!site) fail("give --site <url> with paths, --urls <file>, or --check <file>");
    process.stdout.write(buildSitemap(site, (rest.length ? rest : ["/"]).map((path) => ({ path }))));
  }
} catch (e) { fail(e.message); }
