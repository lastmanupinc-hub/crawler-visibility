/**
 * audit.ts — verify a BUILT page the way a crawler sees it.
 *
 * Run against files in dist/ after build, or against a live URL. It parses raw
 * HTML only — no JavaScript execution — which is exactly what OAI-SearchBot,
 * ClaudeBot, PerplexityBot and most social preview bots do.
 *
 * This is the check that catches the failure mode DevTools hides: a page that
 * looks perfect in a browser and is empty to everything else.
 */

import { readIndexing } from "./head.js";

export interface AuditResult {
  url: string;
  ok: boolean;
  bodyTextLength: number;
  headingCount: number;
  title: string | null;
  description: string | null;
  canonical: string | null;
  jsonLdBlocks: number;
  jsonLdValid: boolean;
  hasPersonNode: boolean;
  noindex: boolean;
  internalLinks: number;
  problems: string[];
}

const strip = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export interface AuditOptions {
  /** Require this Person @id in the JSON-LD graph. Omit to skip the check. */
  personId?: string;
  /** Minimum visible body characters. Default 200. */
  minChars?: number;
  /** Treat a noindex page as passing (previews, staging). Default false: noindex is reported as a problem. */
  allowNoindex?: boolean;
}

export function auditPage(html: string, url = "(string)", opts: AuditOptions = {}): AuditResult {
  const { personId, minChars = 200, allowNoindex = false } = opts;
  const problems: string[] = [];

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : "";
  const bodyText = strip(body);
  const headings = (body.match(/<h[1-3][\s>]/gi) || []).length;

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? null;
  const idx = readIndexing(html);
  const canonical = idx.canonical;

  const ldBlocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  let ldValid = true;
  let hasPerson = false;
  for (const b of ldBlocks) {
    const inner = b.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
    try {
      const parsed = JSON.parse(inner);
      if (personId && JSON.stringify(parsed).includes(personId)) hasPerson = true;
    } catch {
      ldValid = false;
    }
  }

  const internalLinks = (body.match(/<a[^>]+href=["'](\/[^"']*|https?:\/\/[^"']*)["']/gi) || []).length;

  // The checks that matter, in order of severity.
  if (bodyText.length < minChars)
    problems.push(
      `Body text is ${bodyText.length} chars — crawlers that don't run JS see effectively nothing. Pre-render this route.`,
    );
  if (headings === 0) problems.push("No heading (<h1>-<h3>) in raw HTML.");
  if (!title) problems.push("No <title>.");
  if (!description) problems.push("No meta description.");
  if (!canonical) problems.push("No canonical URL.");
  if (ldBlocks.length === 0) problems.push("No JSON-LD.");
  if (!ldValid) problems.push("A JSON-LD block does not parse.");
  if (personId && !hasPerson) problems.push("JSON-LD does not attribute to the canonical Person node.");
  if (idx.noindex && !allowNoindex) problems.push("Page is noindex: search engines will drop it. Pass allowNoindex for previews.");
  if (internalLinks === 0) problems.push("No links in raw HTML — nothing for a crawler to follow.");

  return {
    url,
    ok: problems.length === 0,
    bodyTextLength: bodyText.length,
    headingCount: headings,
    title,
    description,
    canonical,
    jsonLdBlocks: ldBlocks.length,
    jsonLdValid: ldValid,
    hasPersonNode: hasPerson,
    noindex: idx.noindex,
    internalLinks,
    problems,
  };
}
