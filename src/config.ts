/**
 * config.ts — the entity graph, as configuration.
 *
 * Everything the package emits is derived from one object you define once. The
 * point is that a person/organization identity is repeated across dozens of
 * pages and several sites, and the value comes from those repetitions being
 * *byte-identical*. Search engines reconcile entities by matching strings and
 * links; drift between "Jane Q. Example" and "Jane Example" splits one strong
 * entity into two weak ones.
 *
 * So: define it here, import it everywhere, never retype it.
 */

/** A person credited as author/creator across the site. */
export interface PersonConfig {
	/** Stable @id. Convention: `https://your-site.com/#person`. */
	id: string;
	name: string;
	/** The canonical page about this person. Every profile should link here. */
	url: string;
	jobTitle?: string;
	description?: string;
	image?: string;
	knowsAbout?: string[];
	/**
	 * Profile URLs that link BACK to `url`.
	 *
	 * Reciprocity is the whole mechanism. A `sameAs` you declare but that does
	 * not link back is an unverified assertion; reciprocated, it is corroboration
	 * two independent sources agree on. Listing a profile you have not updated
	 * is worse than omitting it.
	 */
	sameAs?: string[];
}

/** The organization publishing the site. */
export interface OrganizationConfig {
	id: string;
	name: string;
	url: string;
	/**
	 * Registered company name, when the public name is a trading name/DBA.
	 * Omit rather than guess: this is checkable against public filings, and a
	 * wrong value is a false statement in machine-readable form.
	 */
	legalName?: string;
	description?: string;
	logo?: string;
	knowsAbout?: string[];
	sameAs?: string[];
}

/** A sibling product to cross-link. Keep this list short and real. */
export interface ProductConfig {
	key: string;
	name: string;
	url: string;
	description?: string;
}

export interface SeoConfig {
	/** Absolute site root, with trailing slash. e.g. "https://example.com/" */
	siteUrl: string;
	siteName: string;
	person?: PersonConfig;
	organization?: OrganizationConfig;
	products?: ProductConfig[];
	/** Default OG image, absolute or site-relative. */
	defaultImage?: string;
}

let current: SeoConfig | null = null;

/** Call once at startup, and in vite.config.ts for the build-time plugin. */
export function defineSeoConfig(config: SeoConfig): SeoConfig {
	if (!config.siteUrl.endsWith('/')) {
		throw new Error(
			`[crawler-visibility] siteUrl must end with a trailing slash (got "${config.siteUrl}"). ` +
				`URLs are resolved against it with new URL(), and without the slash the last ` +
				`path segment is silently dropped.`
		);
	}
	current = config;
	return config;
}

export function getSeoConfig(): SeoConfig {
	if (!current) {
		throw new Error(
			'[crawler-visibility] no config set. Call defineSeoConfig({ siteUrl, siteName, ... }) ' +
				'before rendering, or pass `config` explicitly to buildSchema()/buildMeta().'
		);
	}
	return current;
}

/** Test/SSR helper — clears module state between runs. */
export function resetSeoConfig(): void {
	current = null;
}
