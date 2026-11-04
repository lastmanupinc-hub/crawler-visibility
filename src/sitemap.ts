/** sitemap.ts — per-host sitemap generation and validation. */
const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export interface SitemapEntry { path: string; lastmod?: string; noindex?: boolean; }

/** One sitemap for ONE host. Paths are resolved against siteUrl; anything that resolves to another host throws. noindex entries are skipped. */
export function buildSitemap(siteUrl: string, entries: SitemapEntry[]): string {
  const base = new URL(siteUrl);
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const e of entries) {
    if (e.noindex) continue;
    const u = new URL(e.path, base);
    if (u.host !== base.host) throw new Error(`sitemap: ${u} is not on ${base.host}; build one sitemap per host`);
    u.hash = "";
    const loc = u.toString();
    if (seen.has(loc)) continue;
    seen.add(loc);
    if (e.lastmod && !/^\d{4}-\d{2}-\d{2}/.test(e.lastmod)) throw new Error(`sitemap: lastmod must be W3C date (YYYY-MM-DD...), got ${e.lastmod}`);
    rows.push(`  <url><loc>${xmlEsc(loc)}</loc>${e.lastmod ? `<lastmod>${xmlEsc(e.lastmod)}</lastmod>` : ""}</url>`);
  }
  if (rows.length > 50000) throw new Error("sitemap: more than 50,000 URLs; split into a sitemap index");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

/** Group absolute URLs by host and build one sitemap per host. */
export function buildSitemapsByHost(urls: string[]): Record<string, string> {
  const by: Record<string, string[]> = {};
  for (const raw of urls) { const u = new URL(raw); (by[u.origin] ??= []).push(u.pathname + u.search); }
  return Object.fromEntries(Object.entries(by).map(([origin, paths]) => [new URL(origin).host, buildSitemap(origin, paths.map((path) => ({ path })))]));
}

export interface SitemapReport { valid: boolean; urls: string[]; foreignHostUrls: string[]; duplicates: string[]; problems: string[]; }

/** Validate a fetched sitemap for `host`: XML shape, <loc> count, URLs on other hosts, duplicate locs. */
export function checkSitemap(xml: string | null, host: string): SitemapReport {
  if (xml == null) return { valid: false, urls: [], foreignHostUrls: [], duplicates: [], problems: ["No sitemap.xml"] };
  const problems: string[] = [];
  const isXml = /<(urlset|sitemapindex)[\s>]/i.test(xml) && /<\/(urlset|sitemapindex)>/i.test(xml);
  if (!isXml) problems.push("sitemap.xml is not a <urlset> or <sitemapindex> document");
  const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  if (isXml && urls.length === 0) problems.push("sitemap.xml has no <loc> entries");
  const foreignHostUrls = urls.filter((u) => { try { return new URL(u).host !== host; } catch { return true; } });
  if (foreignHostUrls.length) problems.push(`${foreignHostUrls.length}/${urls.length} sitemap URLs are not on ${host} (search engines ignore cross-host entries)`);
  const seen = new Set<string>(); const duplicates: string[] = [];
  for (const u of urls) { if (seen.has(u)) duplicates.push(u); seen.add(u); }
  if (duplicates.length) problems.push(`${duplicates.length} duplicate <loc> entries`);
  return { valid: isXml && urls.length > 0 && foreignHostUrls.length === 0, urls, foreignHostUrls, duplicates, problems };
}

/** Given sitemaps fetched from several hosts, find byte-identical ones (a shared sitemap deployed to every subdomain). */
export function findDuplicateSitemaps(byHost: Record<string, string | null>): string[][] {
  const groups = new Map<string, string[]>();
  for (const [h, x] of Object.entries(byHost)) { if (x == null) continue; const k = x.trim(); groups.set(k, [...(groups.get(k) ?? []), h]); }
  return [...groups.values()].filter((g) => g.length > 1);
}
