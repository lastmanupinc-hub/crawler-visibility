/** head.ts — small helpers for canonical and noindex tags, plus reading them back. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** <link rel="canonical"> for path on siteUrl (or an absolute URL). Strips fragments. */
export function canonicalTag(pathOrUrl: string, siteUrl?: string): string {
  const u = siteUrl ? new URL(pathOrUrl, siteUrl) : new URL(pathOrUrl);
  u.hash = "";
  return `<link rel="canonical" href="${esc(u.toString())}">`;
}

/** <meta name="robots" content="noindex, follow">. Use for previews, staging, and duplicate mirrors. */
export function noindexTag(follow = true): string {
  return `<meta name="robots" content="noindex, ${follow ? "follow" : "nofollow"}">`;
}

export interface IndexingSignals { noindex: boolean; canonical: string | null; canonicalHost: string | null; }

/** Reads meta robots / googlebot noindex (attribute order independent) and canonical from raw HTML. */
export function readIndexing(html: string, xRobotsTag?: string | null): IndexingSignals {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  let noindex = /noindex/i.test(xRobotsTag ?? "");
  for (const m of metas) {
    if (/name\s*=\s*["']?(robots|googlebot)["']?/i.test(m) && /content\s*=\s*["'][^"']*noindex/i.test(m)) noindex = true;
  }
  const link = (html.match(/<link\b[^>]*>/gi) ?? []).find((l) => /rel\s*=\s*["']?canonical["']?/i.test(l));
  const canonical = link?.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
  let canonicalHost: string | null = null;
  try { canonicalHost = canonical ? new URL(canonical).host : null; } catch { canonicalHost = null; }
  return { noindex, canonical, canonicalHost };
}
