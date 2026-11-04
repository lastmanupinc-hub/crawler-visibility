/**
 * vitePlugin.ts — the universal drop-in.
 *
 * Works with React, Svelte, Vue, or vanilla, because it transforms the built
 * HTML rather than hooking a component tree. One entry in vite.config.ts gives
 * every public route its own real HTML file with its own title, description,
 * canonical, OG tags, and a JSON-LD graph carrying the canonical Person and
 * Organization nodes.
 *
 * What it fixes:
 *   • every route returning one shared <title> and canonical
 *   • no per-page OG tags (so every share preview looks identical)
 *   • no entity attribution in machine-readable form
 *
 * What it does NOT fix on its own: an empty <body>. Content still has to be
 * rendered into HTML — vite-react-ssg for the React apps, or hand-authored
 * static pages. This plugin makes the head correct for every framework; the
 * body is framework-specific.
 *
 * It never injects hidden text or invisible links. Head metadata and JSON-LD
 * only — the sanctioned machine-readable layer.
 */

import type { Plugin } from "vite";
import { buildSchema, buildMeta, type PageKind, type Breadcrumb, type FaqItem } from './schema.js';
import { buildRobots, type AiPolicy } from "./robots.js";
import { buildSitemap } from "./sitemap.js";
import { noindexTag, canonicalTag } from "./head.js";
import type { SeoConfig } from './config.js';

export interface RouteSeo {
  /** Site-relative path, e.g. "/docs". "/" is the home page. */
  path: string;
  title: string;
  description: string;
  kind?: PageKind;
  image?: string;
  product?: string;
  breadcrumbs?: Breadcrumb[];
  /** Only when the Q&A is visibly on the page. */
  faq?: FaqItem[];
  datePublished?: string;
  dateModified?: string;
  /** Emit <meta name="robots" content="noindex, follow"> and leave the route out of sitemap.xml. */
  noindex?: boolean;
  /** Override the canonical (path or absolute URL), e.g. point a mirror at the primary host. */
  canonical?: string;
}

export interface AxisSeoOptions {
  /** The entity graph, from defineSeoConfig(). */
  config: SeoConfig;
  /** Public routes to emit. Do NOT list authenticated app routes. */
  routes: RouteSeo[];
  /** Also write sitemap.xml + robots.txt. Default true. */
  emitSitemap?: boolean;
  /** robots.txt AI-crawler policy. Default "allow-all". */
  aiPolicy?: AiPolicy;
  /** Paths disallowed in robots.txt for every agent. */
  disallow?: string[];
}

const SEO_MARK = "<!--crawler-visibility-->";

/** Strips tags this plugin owns so re-running is idempotent. */
function stripManaged(head: string): string {
  return head
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<link[^>]+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<meta[^>]+name=["']robots["'][^>]*>/gi, "")
    .replace(/<meta[^>]+(?:name|property)=["'](?:description|og:[^"']*|twitter:[^"']*|author|article:[^"']*)["'][^>]*>/gi, "")
    .replace(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi, "");
}

function renderHead(route: RouteSeo, opts: AxisSeoOptions): string {
  const input = { ...route, config: opts.config };
  const meta = buildMeta(input);
  const schema = buildSchema(input);

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const tags = [
    SEO_MARK,
    `<title>${esc(meta.title)}</title>`,
    route.canonical ? canonicalTag(route.canonical, opts.config.siteUrl) : `<link rel="canonical" href="${esc(meta.canonical)}">`,
    ...(route.noindex ? [noindexTag()] : []),
    ...meta.meta.map((m) =>
      "name" in m
        ? `<meta name="${esc(m.name as string)}" content="${esc(m.content)}">`
        : `<meta property="${esc((m as { property: string }).property)}" content="${esc(m.content)}">`,
    ),
    `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`,
  ];
  return tags.join("\n    ");
}

export function crawlerVisibility(opts: AxisSeoOptions): Plugin {
  const { emitSitemap = true } = opts;

  return {
    name: "crawler-visibility",
    apply: "build",
    enforce: "post",

    // Rewrite the shell for the home route, then emit one file per other route.
    generateBundle(_options, bundle) {
      const shellKey = Object.keys(bundle).find((k) => k.endsWith("index.html"));
      if (!shellKey) {
        this.warn("[crawler-visibility] no index.html in bundle — nothing to decorate");
        return;
      }
      const shellAsset = bundle[shellKey];
      if (shellAsset.type !== "asset") return;
      const shellHtml = String(shellAsset.source);

      const inject = (html: string, route: RouteSeo) => {
        const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
        if (!headMatch) return html;
        const cleaned = stripManaged(headMatch[1]);
        const newHead = `${cleaned.trimEnd()}\n    ${renderHead(route, opts)}\n  `;
        return html.replace(headMatch[1], newHead);
      };

      for (const route of opts.routes) {
        const isHome = route.path === "/" || route.path === "";
        const html = inject(shellHtml, route);
        if (isHome) {
          shellAsset.source = html;
        } else {
          const clean = route.path.replace(/^\/+|\/+$/g, "");
          this.emitFile({ type: "asset", fileName: `${clean}/index.html`, source: html });
        }
      }

      if (emitSitemap) {
        this.emitFile({ type: "asset", fileName: "sitemap.xml",
          source: buildSitemap(opts.config.siteUrl, opts.routes.map((r) => ({ path: r.path || "/", lastmod: r.dateModified, noindex: r.noindex }))) });
        this.emitFile({ type: "asset", fileName: "robots.txt",
          source: buildRobots({ siteUrl: opts.config.siteUrl, ai: opts.aiPolicy, disallow: opts.disallow }) });
      }
    },
  };
}

/** Alias kept for users migrating from axis-seo. */
export const axisSeo = crawlerVisibility;
