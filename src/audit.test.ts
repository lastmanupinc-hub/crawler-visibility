import { describe, it, expect } from 'vitest';
import { auditPage } from './audit.js';

/** Minimal page that should pass every check. */
const good = `<!doctype html><html><head>
<title>Docs — Example</title>
<meta name="description" content="How to use the thing.">
<link rel="canonical" href="https://example.com/docs">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"Person","@id":"https://example.com/#person","name":"Jane Example"}]}
</script>
</head><body>
<h1>Documentation</h1>
<p>${'Real prose that a crawler can actually read. '.repeat(8)}</p>
<a href="/">Home</a>
</body></html>`;

/** What an unprerendered SPA actually ships. */
const spaShell = `<!doctype html><html><head>
<title>App</title><meta name="description" content="d">
<link rel="canonical" href="https://example.com/">
<script type="application/ld+json">{"@type":"WebSite"}</script>
</head><body><div id="root"></div><script src="/main.js"></script></body></html>`;

describe('auditPage', () => {
	it('passes a fully rendered page', () => {
		const r = auditPage(good, '/docs');
		expect(r.ok).toBe(true);
		expect(r.problems).toEqual([]);
	});

	it('catches the empty SPA shell — the failure this tool exists for', () => {
		const r = auditPage(spaShell, '/');
		expect(r.ok).toBe(false);
		expect(r.bodyTextLength).toBeLessThan(200);
		expect(r.problems.join(' ')).toMatch(/crawlers/i);
	});

	it('ignores script and style contents when measuring body text', () => {
		// A page can carry a large JS bundle and still be empty to a crawler;
		// counting script bytes as content would hide exactly that.
		const html = `<!doctype html><html><head><title>t</title>
<meta name="description" content="d"><link rel="canonical" href="https://x.com/">
<script type="application/ld+json">{"@id":"https://example.com/#person"}</script>
</head><body><script>${'x'.repeat(5000)}</script><div id="root"></div><a href="/">h</a></body></html>`;
		expect(auditPage(html).bodyTextLength).toBeLessThan(200);
	});

	it('reports invalid JSON-LD rather than silently accepting it', () => {
		const bad = good.replace('{"@context":"https://schema.org"', '{"@context":,');
		const r = auditPage(bad);
		expect(r.jsonLdValid).toBe(false);
		expect(r.problems.join(' ')).toMatch(/parse/i);
	});

	it('flags a page with no headings', () => {
		expect(auditPage(good.replace(/<h1>.*?<\/h1>/, '')).problems.join(' ')).toMatch(/heading/i);
	});

	it('flags missing title, description and canonical individually', () => {
		expect(auditPage(good.replace(/<title>.*?<\/title>/, '')).title).toBeNull();
		expect(auditPage(good.replace(/<meta name="description"[^>]*>/, '')).description).toBeNull();
		expect(auditPage(good.replace(/<link rel="canonical"[^>]*>/, '')).canonical).toBeNull();
	});

	it('flags a page with no links for a crawler to follow', () => {
		expect(auditPage(good.replace(/<a [^>]*>.*?<\/a>/, '')).problems.join(' ')).toMatch(/follow/i);
	});

	it('counts headings and links accurately', () => {
		const r = auditPage(good, '/docs');
		expect(r.headingCount).toBe(1);
		expect(r.internalLinks).toBe(1);
		expect(r.jsonLdBlocks).toBe(1);
	});

	it('extracts title, description and canonical values', () => {
		const r = auditPage(good, '/docs');
		expect(r.title).toBe('Docs — Example');
		expect(r.description).toBe('How to use the thing.');
		expect(r.canonical).toBe('https://example.com/docs');
	});

	it('does not throw on empty or malformed input', () => {
		expect(() => auditPage('')).not.toThrow();
		expect(() => auditPage('<html>')).not.toThrow();
		expect(auditPage('').ok).toBe(false);
	});
});
