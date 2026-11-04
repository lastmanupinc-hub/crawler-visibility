/**
 * schema.ts — builds the JSON-LD graph and head-tag values for a page.
 *
 * This is the machine-readable layer: data for crawlers that users never see.
 * JSON-LD is the mechanism search engines and AI crawlers explicitly support
 * for exactly that, which is why it is the only such mechanism this package
 * offers.
 *
 * What it will never do: emit hidden text, off-screen links, or markup
 * describing content that is not on the page. Search engines treat those as
 * hidden-text abuse and as invalid structured data, and both are enforced by
 * silent ranking demotion rather than a warning. Everything asserted here must
 * be true and visibly present.
 */

import { getSeoConfig, type SeoConfig, type ProductConfig } from './config.js';

export type PageKind =
	| 'website'
	| 'article'
	| 'software'
	| 'collection'
	| 'profile'
	| 'faq';

export interface Breadcrumb {
	name: string;
	url: string;
}

export interface FaqItem {
	question: string;
	/** Must appear verbatim on the rendered page. */
	answer: string;
}

export interface SeoInput {
	kind?: PageKind;
	title: string;
	description: string;
	/** Site-relative path (`/docs`) or absolute URL. Becomes the canonical. */
	path: string;
	image?: string;
	datePublished?: string;
	dateModified?: string;
	breadcrumbs?: Breadcrumb[];
	/** Only when the Q&A is visibly rendered. */
	faq?: FaqItem[];
	/** `key` of a product in config.products. */
	product?: string;
	/** Additional graph nodes. */
	extra?: Record<string, unknown>[];
	/** Overrides the module-level config (useful in tests and multi-site builds). */
	config?: SeoConfig;
}

const absolute = (base: string, path: string) =>
	path.startsWith('http') ? path : new URL(path.replace(/^\//, ''), base).toString();

/** Strips undefined values so the emitted JSON has no empty keys. */
function compact<T extends Record<string, unknown>>(obj: T): T {
	for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
	return obj;
}

/**
 * Builds the `@graph` for a page.
 *
 * Always includes the configured person and organization, so every page
 * reinforces one entity cluster rather than standing alone. That repetition
 * across pages and sites is the entire mechanism — machines reconcile entities
 * by matching identical strings and `@id` values.
 */
export function buildSchema(input: SeoInput): Record<string, unknown> {
	const cfg = input.config ?? getSeoConfig();
	const { siteUrl, siteName, person, organization, products = [] } = cfg;
	const url = absolute(siteUrl, input.path);
	const kind = input.kind ?? 'website';
	const image = input.image ?? cfg.defaultImage;

	const graph: Record<string, unknown>[] = [];

	if (person) {
		graph.push(
			compact({
				'@type': 'Person',
				'@id': person.id,
				name: person.name,
				url: person.url,
				jobTitle: person.jobTitle,
				description: person.description,
				image: person.image,
				knowsAbout: person.knowsAbout,
				sameAs: person.sameAs?.length ? person.sameAs : undefined
			})
		);
	}

	if (organization) {
		graph.push(
			compact({
				'@type': 'Organization',
				'@id': organization.id,
				name: organization.name,
				legalName: organization.legalName,
				url: organization.url,
				description: organization.description,
				logo: organization.logo,
				knowsAbout: organization.knowsAbout,
				founder: person ? { '@id': person.id } : undefined,
				sameAs: organization.sameAs?.length ? organization.sameAs : undefined
			})
		);
	}

	graph.push(
		compact({
			'@type': 'WebSite',
			'@id': `${siteUrl}#website`,
			url: siteUrl,
			name: siteName,
			publisher: organization ? { '@id': organization.id } : undefined,
			creator: person ? { '@id': person.id } : undefined
		})
	);

	const page: Record<string, unknown> = compact({
		'@id': `${url}#page`,
		url,
		name: input.title,
		description: input.description,
		isPartOf: { '@id': `${siteUrl}#website` },
		publisher: organization ? { '@id': organization.id } : undefined,
		author: person ? { '@id': person.id } : undefined,
		image: image ? absolute(siteUrl, image) : undefined,
		datePublished: input.datePublished,
		dateModified: input.dateModified ?? input.datePublished
	});

	switch (kind) {
		case 'article':
			page['@type'] = 'Article';
			page.headline = input.title;
			page.mainEntityOfPage = url;
			break;
		case 'software':
			page['@type'] = ['SoftwareApplication', 'WebPage'];
			page.applicationCategory = 'DeveloperApplication';
			page.operatingSystem = 'Web';
			break;
		case 'collection':
			page['@type'] = 'CollectionPage';
			break;
		case 'profile':
			page['@type'] = 'ProfilePage';
			if (person) page.mainEntity = { '@id': person.id };
			break;
		case 'faq':
			page['@type'] = ['FAQPage', 'WebPage'];
			break;
		default:
			page['@type'] = 'WebPage';
	}

	if (input.product) {
		const p: ProductConfig | undefined = products.find((x) => x.key === input.product);
		if (!p) {
			throw new Error(
				`[crawler-visibility] unknown product "${input.product}". ` +
					`Known: ${products.map((x) => x.key).join(', ') || '(none configured)'}`
			);
		}
		graph.push(
			compact({
				'@type': 'Product',
				'@id': `${p.url}#product`,
				name: p.name,
				url: p.url,
				description: p.description,
				brand: organization ? { '@id': organization.id } : undefined
			})
		);
		page.about = { '@id': `${p.url}#product` };
	}

	graph.push(page);

	if (input.breadcrumbs?.length) {
		graph.push({
			'@type': 'BreadcrumbList',
			'@id': `${url}#breadcrumbs`,
			itemListElement: input.breadcrumbs.map((b, i) => ({
				'@type': 'ListItem',
				position: i + 1,
				name: b.name,
				item: absolute(siteUrl, b.url)
			}))
		});
	}

	if (input.faq?.length) {
		graph.push({
			'@type': 'FAQPage',
			'@id': `${url}#faq`,
			mainEntity: input.faq.map((f) => ({
				'@type': 'Question',
				name: f.question,
				acceptedAnswer: { '@type': 'Answer', text: f.answer }
			}))
		});
	}

	if (input.extra?.length) graph.push(...input.extra);

	return { '@context': 'https://schema.org', '@graph': graph };
}

export interface MetaTag {
	name?: string;
	property?: string;
	content: string;
}

/** Head-tag values for a page. Feed into your framework's head manager. */
export function buildMeta(input: SeoInput): {
	title: string;
	canonical: string;
	meta: MetaTag[];
} {
	const cfg = input.config ?? getSeoConfig();
	const url = absolute(cfg.siteUrl, input.path);
	const image = input.image ?? cfg.defaultImage;
	const img = image ? absolute(cfg.siteUrl, image) : undefined;
	const kind = input.kind ?? 'website';

	const meta: MetaTag[] = [
		{ name: 'description', content: input.description },
		{ property: 'og:type', content: kind === 'article' ? 'article' : 'website' },
		{ property: 'og:title', content: input.title },
		{ property: 'og:description', content: input.description },
		{ property: 'og:url', content: url },
		{ property: 'og:site_name', content: cfg.siteName }
	];

	if (img) {
		meta.push(
			{ property: 'og:image', content: img },
			{ property: 'og:image:width', content: '1200' },
			{ property: 'og:image:height', content: '630' },
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:image', content: img }
		);
	} else {
		meta.push({ name: 'twitter:card', content: 'summary' });
	}

	meta.push(
		{ name: 'twitter:title', content: input.title },
		{ name: 'twitter:description', content: input.description }
	);

	// Plain author meta as well as the JSON-LD node: some crawlers read one and
	// not the other, and the tag costs nothing.
	if (cfg.person) meta.push({ name: 'author', content: cfg.person.name });
	if (input.datePublished)
		meta.push({ property: 'article:published_time', content: input.datePublished });
	if (input.dateModified)
		meta.push({ property: 'article:modified_time', content: input.dateModified });

	return { title: input.title, canonical: url, meta };
}
