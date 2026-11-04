import { describe, it, expect, beforeEach } from 'vitest';
import { defineSeoConfig, resetSeoConfig, getSeoConfig, type SeoConfig } from './config.js';
import { buildSchema, buildMeta } from './schema.js';

const config: SeoConfig = {
	siteUrl: 'https://example.com/',
	siteName: 'Example',
	person: {
		id: 'https://example.com/#person',
		name: 'Jane Q. Example',
		url: 'https://example.com/about',
		jobTitle: 'Founder',
		sameAs: ['https://github.com/janeexample']
	},
	organization: {
		id: 'https://example.com/#org',
		name: 'Example Co',
		url: 'https://example.com/',
		legalName: 'Example Holdings LLC'
	},
	products: [{ key: 'widget', name: 'Widget', url: 'https://widget.example.com/' }],
	defaultImage: '/og.png'
};

const node = (g: Record<string, unknown>, type: string) =>
	(g['@graph'] as Record<string, unknown>[]).find((n) =>
		Array.isArray(n['@type']) ? (n['@type'] as string[]).includes(type) : n['@type'] === type
	);

beforeEach(() => {
	resetSeoConfig();
	defineSeoConfig(config);
});

describe('defineSeoConfig', () => {
	it('rejects a siteUrl without a trailing slash', () => {
		// new URL() silently drops the last path segment without it, which would
		// quietly emit wrong canonicals on every page.
		expect(() => defineSeoConfig({ ...config, siteUrl: 'https://example.com' })).toThrow(
			/trailing slash/
		);
	});

	it('throws a useful error when used before configuration', () => {
		resetSeoConfig();
		expect(() => getSeoConfig()).toThrow(/defineSeoConfig/);
	});
});

describe('buildSchema', () => {
	it('always includes person, organization and website nodes', () => {
		const g = buildSchema({ title: 'T', description: 'D', path: '/' });
		expect(node(g, 'Person')).toBeDefined();
		expect(node(g, 'Organization')).toBeDefined();
		expect(node(g, 'WebSite')).toBeDefined();
	});

	it('attributes every page to the same person @id', () => {
		// The whole mechanism: repetition of one identifier across pages is what
		// lets a crawler reconcile them into a single entity.
		for (const path of ['/', '/docs', '/blog/post']) {
			const g = buildSchema({ title: 'T', description: 'D', path });
			const page = node(g, 'WebPage') ?? node(g, 'Article');
			expect((page!.author as Record<string, string>)['@id']).toBe(config.person!.id);
		}
	});

	it('links organization to person via founder', () => {
		const g = buildSchema({ title: 'T', description: 'D', path: '/' });
		expect((node(g, 'Organization')!.founder as Record<string, string>)['@id']).toBe(
			config.person!.id
		);
	});

	it('resolves site-relative paths against siteUrl', () => {
		const g = buildSchema({ title: 'T', description: 'D', path: '/docs' });
		expect(node(g, 'WebPage')!.url).toBe('https://example.com/docs');
	});

	it('passes absolute URLs through unchanged', () => {
		const g = buildSchema({ title: 'T', description: 'D', path: 'https://other.com/x' });
		expect(node(g, 'WebPage')!.url).toBe('https://other.com/x');
	});

	it('emits Article with a headline for kind=article', () => {
		const g = buildSchema({ kind: 'article', title: 'My Post', description: 'D', path: '/p' });
		expect(node(g, 'Article')!.headline).toBe('My Post');
	});

	it('emits ProfilePage pointing at the person for kind=profile', () => {
		const g = buildSchema({ kind: 'profile', title: 'About', description: 'D', path: '/about' });
		expect((node(g, 'ProfilePage')!.mainEntity as Record<string, string>)['@id']).toBe(
			config.person!.id
		);
	});

	it('omits undefined fields rather than emitting empty keys', () => {
		const g = buildSchema({ title: 'T', description: 'D', path: '/' });
		const person = node(g, 'Person')!;
		expect('description' in person).toBe(false);
		expect(person.jobTitle).toBe('Founder');
	});

	it('adds breadcrumbs with 1-based positions', () => {
		const g = buildSchema({
			title: 'T',
			description: 'D',
			path: '/docs',
			breadcrumbs: [
				{ name: 'Home', url: '/' },
				{ name: 'Docs', url: '/docs' }
			]
		});
		const items = node(g, 'BreadcrumbList')!.itemListElement as Record<string, unknown>[];
		expect(items.map((i) => i.position)).toEqual([1, 2]);
		expect(items[1].item).toBe('https://example.com/docs');
	});

	it('associates a known product and rejects an unknown one', () => {
		const g = buildSchema({ title: 'T', description: 'D', path: '/', product: 'widget' });
		expect(node(g, 'Product')!.name).toBe('Widget');
		// Failing loudly at build time beats emitting a dangling reference that
		// nothing validates and no one notices.
		expect(() => buildSchema({ title: 'T', description: 'D', path: '/', product: 'nope' })).toThrow(
			/unknown product/
		);
	});

	it('emits FAQ only when supplied', () => {
		expect(node(buildSchema({ title: 'T', description: 'D', path: '/' }), 'FAQPage')).toBeUndefined();
		const withFaq = buildSchema({
			title: 'T',
			description: 'D',
			path: '/',
			faq: [{ question: 'Q?', answer: 'A.' }]
		});
		expect(node(withFaq, 'FAQPage')).toBeDefined();
	});

	it('produces valid serializable JSON', () => {
		const g = buildSchema({ title: 'T', description: 'D', path: '/', product: 'widget' });
		expect(() => JSON.parse(JSON.stringify(g))).not.toThrow();
		expect(g['@context']).toBe('https://schema.org');
	});

	it('accepts an explicit config without module state', () => {
		resetSeoConfig();
		const g = buildSchema({ title: 'T', description: 'D', path: '/', config });
		expect(node(g, 'Person')).toBeDefined();
	});
});

describe('buildMeta', () => {
	it('returns the canonical as an absolute URL', () => {
		expect(buildMeta({ title: 'T', description: 'D', path: '/docs' }).canonical).toBe(
			'https://example.com/docs'
		);
	});

	it('uses summary_large_image when an image resolves', () => {
		const m = buildMeta({ title: 'T', description: 'D', path: '/' });
		const card = m.meta.find((t) => t.name === 'twitter:card');
		expect(card?.content).toBe('summary_large_image');
		expect(m.meta.find((t) => t.property === 'og:image')?.content).toBe(
			'https://example.com/og.png'
		);
	});

	it('falls back to summary with no image configured', () => {
		resetSeoConfig();
		defineSeoConfig({ ...config, defaultImage: undefined });
		expect(
			buildMeta({ title: 'T', description: 'D', path: '/' }).meta.find(
				(t) => t.name === 'twitter:card'
			)?.content
		).toBe('summary');
	});

	it('sets og:type=article only for articles', () => {
		const t = (kind: 'website' | 'article') =>
			buildMeta({ kind, title: 'T', description: 'D', path: '/' }).meta.find(
				(m) => m.property === 'og:type'
			)?.content;
		expect(t('article')).toBe('article');
		expect(t('website')).toBe('website');
	});

	it('never emits duplicate tag keys', () => {
		// Two tags with the same name means the first wins silently — the exact
		// bug that gave a whole site one shared title.
		const m = buildMeta({ title: 'T', description: 'D', path: '/', datePublished: '2026-01-01' });
		const keys = m.meta.map((t) => t.name ?? t.property);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
