# Changelog

## 0.4.0 (2026-11-03)
- Security: SSRF guard for live URLs (private, loopback, link-local/metadata, CGNAT, ULA refused unless `--allow-private`; each redirect re-checked), http(s) only, no URL credentials, `--max-bytes` body cap (default 5 MB), overall redirect deadline, terminal control characters stripped from remote text, `cv-sitemap --out` cannot write outside its directory.
- `cv-audit --markdown`: report tables for PR comments and job summaries (escaped).
- `action.yml`: GitHub Action wrapper that writes the report to the job summary; tested in CI.
- Repository: lastmanupinc-hub/crawler-visibility (tool only).
- CLI: unknown flags and flags missing values are errors; `--json` and `--markdown` are exclusive.

## 0.3.0 (2026-11-03)
- `cv-audit --grade`: A-F on a 10-check rubric (page + robots.txt + sitemap.xml), `--fail-below` CI gate.
- `cv-robots`: robots.txt generator with explicit AI search vs. training crawler groups; `--check` parser.
- `cv-sitemap`: per-host sitemap generator and validator (cross-host and duplicate `<loc>` detection); `findDuplicateSitemaps()` for subdomains sharing one file.
- noindex/canonical: `noindexTag`, `canonicalTag`, `readIndexing` (meta robots in any attribute order, X-Robots-Tag); audit reports noindex pages (`--allow-noindex`); Vite plugin `noindex` and `canonical` per route, noindex routes left out of sitemap.
- HTTP: redirects followed by hand and reported, loop detection, per-host request spacing (`--delay`, min 250 ms), several URLs per run, identifying user-agent.
- Vite plugin robots.txt now names AI crawlers (`aiPolicy`, `disallow`).
- Docs: rubric documented; README states the package is not on npm yet and cv-prerender's Chrome step is unverified.

## 0.2.0 (2026-11-03): first release as crawler-visibility
- Audit: the Person check is now opt-in (`--person <@id>` / `CV_PERSON_ID` / `auditPage(html, url, { personId })`). In axis-seo 0.1.0 it required `jonathanarvay.com/#person`, so every other site failed.
- Audit: `--min <chars>` threshold, `--json` output, exit 2 on missing paths, bad flags, HTTP errors and network timeouts (20s). The CLI now uses the tested library code instead of a duplicate.
- Plugin: JSON-LD is escaped so a `</script>` in a title can't break out of the tag. Sitemap URLs and head attributes are XML/HTML-escaped.
- Plugin renamed `crawlerVisibility()`. `axisSeo()` is kept as an alias.
- Prerender: no longer misreads arguments when `--routes` is missing.
- Removed the React components (owner-specific ecosystem footer).
- Tests: 30 to 38.
