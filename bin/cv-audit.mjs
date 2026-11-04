#!/usr/bin/env node
/**
 * cv-audit: check pages the way a crawler that doesn't run JavaScript sees them.
 *
 *   cv-audit dist                              every .html under dist/
 *   cv-audit https://example.com/ [url...]     live URLs (raw HTML, no JS, GET only)
 *   cv-audit https://example.com/ --grade      A-F grade on the 10-check rubric (also fetches robots.txt + sitemap.xml)
 *   options: --person <@id>  --min <chars>  --allow-noindex  --delay <ms per host, default 1000>
 *            --json | --markdown   --max-bytes <n, default 5 MB>  --allow-private (permit localhost / internal IPs)
 *
 * Exit codes: 0 all pass (with --grade: every grade at or above --fail-below, default F) · 1 a page failed · 2 usage, network or HTTP error.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { auditPage } from "../dist/audit.js";
import { gradePage } from "../dist/grade.js";
import { get, getOptional, setDelay, setAllowPrivate, safe } from "./http.mjs";
import { auditMarkdown, gradeMarkdown } from "./report.mjs";

const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : undefined; };
const USAGE = "usage: cv-audit <dist-dir | file.html | url...> [--grade [--fail-below A-F]] [--person <@id>] [--min <chars>] [--allow-noindex] [--delay <ms>] [--max-bytes <n>] [--allow-private] [--json | --markdown]";
if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); process.exit(0); }
const valued = new Set(["--person", "--min", "--delay", "--fail-below", "--max-bytes"]);
const targets = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1]));
const fail = (msg) => { console.error(`cv-audit: ${msg}`); process.exit(2); };
const personId = flag("--person") ?? process.env.CV_PERSON_ID ?? undefined;
const minRaw = flag("--min"); const minChars = minRaw === undefined ? 200 : Number(minRaw);
const delayRaw = flag("--delay"); const delay = delayRaw === undefined ? 1000 : Number(delayRaw);
const failBelow = (flag("--fail-below") ?? "F").toUpperCase();
const json = argv.includes("--json"); const grade = argv.includes("--grade"); const markdown = argv.includes("--markdown");
const maxRaw = flag("--max-bytes"); const maxBytes = maxRaw === undefined ? 5 * 1024 * 1024 : Number(maxRaw);
const known = new Set([...valued, "--json", "--grade", "--markdown", "--allow-noindex", "--allow-private", "--help", "-h"]);
const unknown = argv.find((a) => a.startsWith("--") && !known.has(a));

if (unknown) fail(`unknown option ${unknown}. Try --help.`);
if (!targets.length) fail("missing target. Try --help.");
if (json && markdown) fail("pick one of --json or --markdown");
if (!Number.isInteger(maxBytes) || maxBytes < 1024) fail(`--max-bytes must be an integer of at least 1024 (got "${maxRaw}")`);
for (const v of valued) if (argv.includes(v) && (flag(v) === undefined || flag(v).startsWith("--"))) fail(`${v} needs a value`);
if (!Number.isFinite(minChars) || minChars < 0) fail(`--min must be a non-negative number (got "${minRaw}")`);
if (!Number.isFinite(delay) || delay < 250) fail(`--delay must be at least 250 ms so live sites are not hammered (got "${delayRaw}")`);
if (!/^[A-F]$/.test(failBelow) || failBelow === "E") fail(`--fail-below must be one of A B C D F (got "${failBelow}")`);
const isUrl = (t) => /^https?:\/\//i.test(t);
if (grade && !targets.every(isUrl)) fail("--grade needs live URLs (it checks status, timing, robots.txt and sitemap.xml)");
setDelay(delay); setAllowPrivate(argv.includes("--allow-private"));
const hopts = { maxBytes };

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else if (e.endsWith(".html")) out.push(p);
  }
  return out;
}
async function fetchPage(t) {
  let r; try { r = await get(t, hopts); } catch (e) { fail(`could not fetch ${t}: ${e.cause?.code ?? e.message}`); }
  if (r.status !== 200) fail(`${t} returned HTTP ${r.status}${r.chain.length ? ` (after redirect to ${r.url})` : ""}`);
  return r;
}
const redirectNote = (r) => r.chain.length ? `redirect: ${r.chain.map((c) => `${c.from} -${c.status}-> ${c.to}`).join(" ; ")}` : null;

if (grade) {
  const out = [];
  for (const t of targets) {
    let r;
    try { r = await get(t, hopts); } catch (e) { r = { error: e.cause?.code ?? e.message }; }
    if (r.error || r.status !== 200) {
      // One bad URL should not hide the others: grade it F and keep going.
      out.push({ url: t, grade: "F", score: 0, checks: [], unreachable: true, notes: [r.error ? `unreachable: ${r.error}` : `HTTP ${r.status}${r.chain?.length ? ` after redirect to ${r.url}` : ""}`] });
      continue;
    }
    const origin = new URL(r.url).origin;
    const robotsTxt = await getOptional(`${origin}/robots.txt`, hopts);
    const sitemapXml = await getOptional(`${origin}/sitemap.xml`, hopts);
    out.push(gradePage({ url: r.url, status: r.status, timeMs: r.timeMs, html: r.text, robotsTxt, sitemapXml, xRobotsTag: r.headers.get("x-robots-tag"), redirectedFrom: r.chain.length ? t : undefined }));
  }
  if (json) console.log(JSON.stringify(out, null, 2));
  else if (markdown) process.stdout.write(gradeMarkdown(out));
  else for (const g of out) {
    console.log(`${g.grade}  ${g.score}/10  ${safe(g.url)}`);
    for (const c of g.checks) console.log(`   ${c.pass ? "ok  " : "MISS"} ${c.label}${c.detail ? `  (${safe(c.detail)})` : ""}`);
    for (const n of g.notes) console.log(`   note: ${safe(n)}`);
  }
  if (out.some((g) => g.unreachable)) process.exit(2);
  const order = "ABCDF";
  process.exit(out.some((g) => order.indexOf(g.grade) > order.indexOf(failBelow)) ? 1 : 0);
}

const opts = { personId, minChars, allowNoindex: argv.includes("--allow-noindex") };
const results = [];
for (const t of targets) {
  if (isUrl(t)) {
    const r = await fetchPage(t);
    const a = auditPage(r.text, r.url, opts); const n = redirectNote(r);
    results.push(n ? { ...a, notes: [n] } : a);
  } else {
    if (!existsSync(t)) fail(`no such file or directory: ${t}`);
    const isFile = statSync(t).isFile();
    const files = isFile ? [t] : walk(t);
    if (!files.length) fail(`no .html files under ${t}`);
    for (const f of files) results.push(auditPage(readFileSync(f, "utf8"), isFile ? f : relative(t, f), opts));
  }
}
const failed = results.filter((r) => !r.ok).length;
if (json) console.log(JSON.stringify({ pages: results.length, failed, results }, null, 2));
else if (markdown) process.stdout.write(auditMarkdown(results));
else {
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${safe(r.url)}`);
    console.log(`      text:${r.bodyTextLength}  headings:${r.headingCount}  json-ld:${r.jsonLdBlocks}  links:${r.internalLinks}${r.noindex ? "  noindex" : ""}`);
    for (const n of r.notes ?? []) console.log(`      ${safe(n)}`);
    for (const p of r.problems) console.log(`      - ${p}`);
  }
  console.log(`\n${results.length - failed}/${results.length} pages readable without JavaScript`);
  if (failed) console.log("Each finding is explained in the README (\"What cv-audit checks\").");
}
process.exit(failed ? 1 : 0);
