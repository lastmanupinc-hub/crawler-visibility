/** crawler-visibility: core entry point. Framework-agnostic. Vite plugin at `crawler-visibility/vite`. */
export { defineSeoConfig, getSeoConfig, resetSeoConfig, type SeoConfig, type PersonConfig, type OrganizationConfig, type ProductConfig } from './config.js';
export { buildSchema, buildMeta, type SeoInput, type PageKind, type Breadcrumb, type FaqItem, type MetaTag } from './schema.js';
export { auditPage, type AuditResult, type AuditOptions } from './audit.js';
export { buildRobots, parseRobots, AI_CRAWLERS, type AiPolicy, type RobotsOptions, type RobotsReport } from './robots.js';
export { buildSitemap, buildSitemapsByHost, checkSitemap, findDuplicateSitemaps, type SitemapEntry, type SitemapReport } from './sitemap.js';
export { canonicalTag, noindexTag, readIndexing, type IndexingSignals } from './head.js';
export { gradePage, letter, RUBRIC_MIN_TEXT, type GradeInput, type GradeResult, type Check } from './grade.js';
