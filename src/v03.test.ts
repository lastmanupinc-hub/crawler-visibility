import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { buildRobots, parseRobots } from "./robots";
import { buildSitemap, buildSitemapsByHost, checkSitemap, findDuplicateSitemaps } from "./sitemap";
import { canonicalTag, noindexTag, readIndexing } from "./head";
import { auditPage } from "./audit";
import { gradePage, letter } from "./grade";
// @ts-ignore plain JS helper shared by the CLIs
import { get, pace, setDelay, setAllowPrivate } from "../bin/http.mjs";

const page = (extra = "", text = "x ".repeat(600)) => `<!doctype html><html><head><title>T</title><meta name="description" content="d"><link rel="canonical" href="https://a.test/"><meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:url" content="u"><meta property="og:type" content="website"><script type="application/ld+json">{"@type":"WebSite"}</script>${extra}</head><body><h1>H</h1><p>${text}</p><a href="/x">x</a></body></html>`;

describe("robots generator", () => {
  it("names AI crawlers and keeps sitemap line", () => {
    const r = buildRobots({ siteUrl: "https://a.test", disallow: ["/app/"] });
    expect(r).toContain("User-agent: GPTBot"); expect(r).toContain("User-agent: OAI-SearchBot");
    expect(r).toContain("Sitemap: https://a.test/sitemap.xml"); expect(r).not.toMatch(/User-agent: \*\nDisallow: \/\n/);
  });
  it("search-only blocks training bots but allows search bots", () => {
    const r = buildRobots({ siteUrl: "https://a.test", ai: "search-only" });
    expect(r).toMatch(/User-agent: GPTBot[\s\S]*?Disallow: \//); expect(r).toMatch(/User-agent: Claude-User\nAllow: \//);
  });
  it("rejects bad input", () => {
    expect(() => buildRobots({ siteUrl: "https://a.test", disallow: ["app"] })).toThrow();
    expect(() => buildRobots({ siteUrl: "https://a.test", ai: "nope" as any })).toThrow();
  });
  it("parser round-trips and detects disallow-all", () => {
    const p = parseRobots(buildRobots({ siteUrl: "https://a.test" }));
    expect(p.aiRules).toContain("GPTBot"); expect(p.disallowAll).toBe(false); expect(p.sitemaps).toHaveLength(1);
    expect(parseRobots("User-agent: *\nDisallow: /").disallowAll).toBe(true);
    expect(parseRobots(null).exists).toBe(false);
  });
});

describe("per-host sitemaps", () => {
  it("rejects foreign-host paths, dedupes, skips noindex, escapes", () => {
    expect(() => buildSitemap("https://a.test", [{ path: "https://b.test/" }])).toThrow(/one sitemap per host/);
    const x = buildSitemap("https://a.test", [{ path: "/" }, { path: "/#top" }, { path: "/p?a=1&b=2" }, { path: "/hidden", noindex: true }]);
    expect(x.match(/<loc>/g)).toHaveLength(2); expect(x).toContain("&amp;b=2"); expect(x).not.toContain("hidden");
    expect(() => buildSitemap("https://a.test", [{ path: "/", lastmod: "yesterday" }])).toThrow();
  });
  it("splits by host", () => {
    const m = buildSitemapsByHost(["https://a.test/", "https://b.test/x", "https://a.test/y"]);
    expect(Object.keys(m).sort()).toEqual(["a.test", "b.test"]); expect(m["a.test"].match(/<loc>/g)).toHaveLength(2);
  });
  it("checker flags cross-host URLs and duplicates; finds shared sitemaps", () => {
    const shared = buildSitemap("https://store.test", [{ path: "/" }]);
    const r = checkSitemap(shared, "seo.test"); expect(r.valid).toBe(false); expect(r.foreignHostUrls).toHaveLength(1);
    expect(checkSitemap("<urlset><url><loc>https://a.test/</loc></url><url><loc>https://a.test/</loc></url></urlset>", "a.test").duplicates).toHaveLength(1);
    expect(checkSitemap("<html>404</html>", "a.test").valid).toBe(false);
    expect(findDuplicateSitemaps({ "a.test": shared, "b.test": shared, "c.test": null, "d.test": "<urlset/>" })).toEqual([["a.test", "b.test"]]);
  });
});

describe("noindex / canonical", () => {
  it("helpers emit and read back", () => {
    expect(canonicalTag("/p#x", "https://a.test")).toBe('<link rel="canonical" href="https://a.test/p">');
    expect(readIndexing(`<meta content="noindex, follow" name="robots">`).noindex).toBe(true);
    expect(readIndexing(noindexTag()).noindex).toBe(true);
    expect(readIndexing("<p></p>", "noindex").noindex).toBe(true);
    expect(readIndexing(`<link href="https://b.test/" rel="canonical">`).canonicalHost).toBe("b.test");
  });
  it("audit flags noindex unless allowed", () => {
    expect(auditPage(page(noindexTag())).problems.join()).toMatch(/noindex/);
    expect(auditPage(page(noindexTag()), "", { allowNoindex: true }).ok).toBe(true);
  });
});

describe("grade rubric", () => {
  const robots = buildRobots({ siteUrl: "https://a.test" }), sm = buildSitemap("https://a.test", [{ path: "/" }]);
  it("letters", () => { expect([10, 9, 8, 7, 6, 5, 4, 3, 2, 0].map(letter).join("")).toBe("AABBCCDDFF"); });
  it("full page scores A 10/10", () => {
    const g = gradePage({ url: "https://a.test/", status: 200, timeMs: 200, html: page(), robotsTxt: robots, sitemapXml: sm });
    expect(g.score).toBe(10); expect(g.grade).toBe("A");
  });
  it("bare page scores F, shared sitemap and slow response cost points", () => {
    const g = gradePage({ url: "https://a.test/", status: 200, timeMs: 1500, html: "<html><body>hi</body></html>", robotsTxt: null, sitemapXml: null });
    expect(g.grade).toBe("F");
    const s = gradePage({ url: "https://seo.a.test/", status: 200, timeMs: 100, html: page(), robotsTxt: robots, sitemapXml: sm });
    expect(s.checks.find((c) => c.id === "sitemap")!.pass).toBe(false);
  });
});

describe("http: redirects + per-host pacing", () => {
  let srv: Server; let base = "";
  beforeAll(async () => {
    srv = createServer((q, r) => {
      if (q.url === "/a") { r.writeHead(301, { location: "/b" }); return r.end(); }
      if (q.url === "/loop") { r.writeHead(302, { location: "/loop2" }); return r.end(); }
      if (q.url === "/loop2") { r.writeHead(302, { location: "/loop" }); return r.end(); }
      r.end("ok");
    });
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", () => res()));
    base = `http://127.0.0.1:${(srv.address() as any).port}`;
  });
  afterAll(() => srv.close());
  beforeAll(() => setAllowPrivate(true));
  afterAll(() => setAllowPrivate(false));
  it("reports the redirect chain", async () => {
    setDelay(0);
    const r = await get(`${base}/a`); expect(r.status).toBe(200); expect(r.url).toBe(`${base}/b`); expect(r.chain[0].status).toBe(301);
  });
  it("detects redirect loops", async () => { setDelay(0); await expect(get(`${base}/loop`)).rejects.toThrow(/loop|redirects/); });
  it("spaces requests to the same host", async () => {
    setDelay(300); const t = Date.now(); await pace("h.test"); await pace("h.test"); await pace("other.test");
    expect(Date.now() - t).toBeGreaterThanOrEqual(290); expect(Date.now() - t).toBeLessThan(600); setDelay(1000);
  });
});

import { crawlerVisibility } from "./vitePlugin";
describe("vite plugin: noindex, canonical override, AI robots", () => {
  it("emits noindex + canonical override, leaves noindex routes out of sitemap", () => {
    const emitted: Record<string, string> = {};
    const bundle: any = { "index.html": { type: "asset", source: "<html><head></head><body><h1>x</h1></body></html>" } };
    const plugin: any = crawlerVisibility({ config: { siteUrl: "https://a.test/", siteName: "A" } as any, aiPolicy: "search-only", disallow: ["/app/"],
      routes: [{ path: "/", title: "Home", description: "d" }, { path: "/preview", title: "P", description: "d", noindex: true, canonical: "https://primary.test/p" }] });
    plugin.generateBundle.call({ emitFile: (f: any) => { emitted[f.fileName] = f.source; }, warn: () => {} }, {}, bundle);
    const p = emitted["preview/index.html"];
    expect(p).toContain('content="noindex, follow"'); expect(p).toContain('href="https://primary.test/p"');
    expect(p.match(/rel="canonical"/g)).toHaveLength(1);
    expect(emitted["sitemap.xml"]).not.toContain("/preview"); expect(emitted["robots.txt"]).toContain("Disallow: /app/");
    expect(emitted["robots.txt"]).toMatch(/User-agent: GPTBot[\s\S]*?Disallow: \//);
  });
});
