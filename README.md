# crawler-visibility

**See your site the way ChatGPT's, Claude's and Perplexity's crawlers see it.**

Published tests found that GPTBot, OAI-SearchBot, ClaudeBot and PerplexityBot fetch your HTML but don't run your JavaScript ([Vercel](https://vercel.com/blog/the-rise-of-the-ai-crawler), [Genbox 2026](https://genbox.app/experiments/js-execution/)). A client-rendered app looks like an empty `<div id="root"></div>` to them.

```bash
npx cv-audit https://yoursite.com/          # free check of any live page, raw HTML only
npx cv-audit https://yoursite.com/ --grade  # A-F on a 10-check rubric (adds robots.txt + sitemap.xml)
npx cv-audit dist --markdown > report.md    # table for a PR comment or job summary
```
> Not on npm yet. Until it is published, run from a clone: `npm ci && npm run build && node bin/cv-audit.mjs <target>`.
```
FAIL  https://yoursite.com/
      text:0  headings:0  json-ld:0  links:0
      - Body text is 0 chars — crawlers that don't run JS see effectively nothing. Pre-render this route.
```

## What's in the box (MIT, free)
| Piece | What it does |
|---|---|
| `cv-audit <dist\|file\|url...>` | Fails (exit 1) on pages with under 200 characters of body text, no h1-h3, title, description or canonical, missing or invalid JSON-LD, no links, or `noindex` (pass `--allow-noindex` for previews). Reports redirect chains. `--min`, `--person <@id>`, `--delay <ms>` (per-host spacing, default 1000, minimum 250), `--max-bytes <n>` (default 5 MB), `--allow-private`, `--json` or `--markdown`. Unknown flags are an error. Exit 2 on bad input, network or HTTP errors. |
| `cv-audit <url> --grade` | Grades A-F on the rubric below. GET only: the page, `/robots.txt`, `/sitemap.xml`. `--fail-below B` exits 1 under B (CI gate). |
| `cv-robots --site <url>` | Prints a robots.txt with explicit AI-crawler groups. `--ai allow-all\|search-only\|block-all` (search-only = stay in AI answers, opt out of training), `--disallow /app/,/api/`. `--check robots.txt` reports which AI bots a file names. |
| `cv-sitemap` | One sitemap per host: `--site <url> <paths...>`, or `--urls list.txt --out dir/` (writes `dir/<host>/sitemap.xml`). `--check sitemap.xml --host h` flags cross-host and duplicate URLs. |
| `crawler-visibility/vite` | Build plugin: one HTML file per public route with its own title, canonical, description, Open Graph/Twitter tags and a JSON-LD `@graph`. Per route: `noindex: true` (adds `noindex, follow` and drops it from the sitemap) and `canonical` override. Writes `sitemap.xml` and an AI-aware `robots.txt` (`aiPolicy`, `disallow`). |
| `cv-prerender <dist> --routes <file>` | Captures each route's rendered `#root` with an installed Chrome/Edge and writes it into the HTML. Unit-tested argument handling only; the Chrome step has not been verified in CI. |
| `buildSchema`, `buildMeta`, `auditPage`, `gradePage`, `buildRobots`, `parseRobots`, `buildSitemap`, `checkSitemap`, `findDuplicateSitemaps`, `canonicalTag`, `noindexTag`, `readIndexing` | The same logic as functions. |

### GitHub Action
```yaml
- run: npm run build
- uses: lastmanupinc-hub/crawler-visibility@v0.4.0   # works once the repo is public; until then copy action.yml into your repo
  with: { target: dist }                                 # or: target: https://yoursite.com/  grade: true  fail-below: B
```
Writes the Markdown report to the job summary and exposes its path as `outputs.report`. Inputs reach the shell only as environment variables and are word-split, never evaluated.

### Safety when fetching URLs
- GET only, `http`/`https` only, no credentials in URLs, at most 5 redirects, each hop re-checked.
- Refuses hosts that resolve to loopback, private (RFC 1918), link-local/cloud metadata (169.254.0.0/16), CGNAT, multicast and IPv6 ULA/link-local addresses. `--allow-private` turns this off for local servers. 198.18.0.0/15 is allowed because fake-IP DNS proxies use it for public hosts.
- Known limit: the address is checked at lookup time; a DNS server that answers differently on the second lookup (DNS rebinding) is not defended against. Don't run it as a service on untrusted input.
- Bodies over `--max-bytes` are cut off with an error; each request times out after 20 s, a whole redirect chain after 40 s.
- Remote text is stripped of terminal control characters before printing and escaped in `--markdown`.
- `cv-sitemap --out` only writes inside the directory you give it; host names are sanitised into folder names.

### The `--grade` rubric (1 point each)
200 in under 1 s · `<title>` · meta description · canonical · 4+ Open Graph tags · valid JSON-LD · exactly one `<h1>` · 1000+ characters of text without JS · robots.txt naming AI crawlers (and not blocking `*`) · valid sitemap.xml whose URLs are on the same host.
A 9-10 · B 7-8 · C 5-6 · D 3-4 · F 0-2. Timing is measured from wherever you run it, so it varies by network.

**What it does not do:** it doesn't render your page body by itself. The plugin fixes the `<head>`; for the body use your framework's static generation or `cv-prerender`. It doesn't emit price/Offer markup, hide text, or cloak.

## Quick start
```bash
npm i -D crawler-visibility vite
```
```ts
// seo.config.ts
import { defineSeoConfig } from 'crawler-visibility';
import type { RouteSeo } from 'crawler-visibility/vite';
export default defineSeoConfig({
  siteUrl: 'https://example.com/',          // trailing slash required
  siteName: 'Example',
  organization: { id: 'https://example.com/#org', name: 'Example', url: 'https://example.com/' },
});
export const routes: RouteSeo[] = [
  { path: '/', title: 'Example: widgets that work', description: 'What it is, for whom.' },
  { path: '/docs', title: 'Docs · Example', description: 'How to use it.', kind: 'article' },
];
```
```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { crawlerVisibility } from 'crawler-visibility/vite';
import config, { routes } from './seo.config';
export default defineConfig({ plugins: [crawlerVisibility({ config, routes })] });
```
```json
{ "scripts": { "build": "vite build && cv-audit dist" } }
```
List public routes only. `kind`: `website` · `article` · `software` · `collection` · `profile` · `faq` (FAQ answers must be visible on the page).

## Credits
Derived from [axis-seo](https://github.com/lastmanupinc-hub/axis-seo) by Jonathan Arvay (MIT). See NOTICE.md and CHANGELOG.md.
