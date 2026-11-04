/**
 * grade.ts — the A-F rubric used in SITE_GRADES.md, as code.
 * 10 checks, 1 point each: A 9-10 · B 7-8 · C 5-6 · D 3-4 · F 0-2.
 */
import { auditPage } from "./audit.js";
import { parseRobots } from "./robots.js";
import { checkSitemap } from "./sitemap.js";
import { readIndexing } from "./head.js";

export interface GradeInput {
  url: string;           // final URL after redirects
  status: number;
  timeMs: number;
  html: string;
  robotsTxt: string | null;
  sitemapXml: string | null;
  xRobotsTag?: string | null;
  redirectedFrom?: string;
}
export interface Check { id: string; label: string; pass: boolean; detail?: string; }
export interface GradeResult { url: string; grade: "A" | "B" | "C" | "D" | "F"; score: number; checks: Check[]; notes: string[]; }

export const RUBRIC_MIN_TEXT = 1000;

export function letter(score: number): GradeResult["grade"] {
  return score >= 9 ? "A" : score >= 7 ? "B" : score >= 5 ? "C" : score >= 3 ? "D" : "F";
}

export function gradePage(i: GradeInput): GradeResult {
  const a = auditPage(i.html, i.url, { minChars: 0 });
  const host = new URL(i.url).host;
  const og = (i.html.match(/<meta[^>]+property=["']og:[^"']+["']/gi) ?? []).length;
  const h1 = (i.html.match(/<h1[\s>]/gi) ?? []).length;
  const robots = parseRobots(i.robotsTxt);
  const sm = checkSitemap(i.sitemapXml, host);
  const idx = readIndexing(i.html, i.xRobotsTag);
  const checks: Check[] = [
    { id: "status", label: "200 in under 1s", pass: i.status === 200 && i.timeMs < 1000, detail: `${i.status}, ${Math.round(i.timeMs)}ms` },
    { id: "title", label: "<title>", pass: !!a.title },
    { id: "description", label: "meta description", pass: !!a.description },
    { id: "canonical", label: "canonical", pass: !!idx.canonical, detail: idx.canonical ?? undefined },
    { id: "og", label: "Open Graph tags (>=4)", pass: og >= 4, detail: `${og}` },
    { id: "jsonld", label: "valid JSON-LD", pass: a.jsonLdBlocks > 0 && a.jsonLdValid, detail: `${a.jsonLdBlocks} block(s)` },
    { id: "h1", label: "exactly one <h1>", pass: h1 === 1, detail: `${h1}` },
    { id: "text", label: `>=${RUBRIC_MIN_TEXT} chars text without JS`, pass: a.bodyTextLength >= RUBRIC_MIN_TEXT, detail: `${a.bodyTextLength}` },
    { id: "robots", label: "robots.txt with explicit AI-crawler rules", pass: robots.exists && !robots.disallowAll && robots.aiRules.length > 0, detail: robots.exists ? (robots.aiRules.join(", ") || "no AI bots named") : "missing" },
    { id: "sitemap", label: "valid sitemap.xml for this host", pass: sm.valid, detail: sm.problems.join("; ") || `${sm.urls.length} URLs` },
  ];
  const notes: string[] = [];
  if (i.redirectedFrom) notes.push(`redirected from ${i.redirectedFrom}`);
  if (idx.noindex) notes.push("page is noindex (intentional for previews; otherwise it will not be indexed)");
  if (idx.canonicalHost && idx.canonicalHost !== host) notes.push(`canonical points to another host (${idx.canonicalHost})`);
  if (robots.disallowAll) notes.push("robots.txt blocks all agents");
  const score = checks.filter((c) => c.pass).length;
  return { url: i.url, grade: letter(score), score, checks, notes };
}
