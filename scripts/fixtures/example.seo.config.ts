// Minimal example config used by scripts/e2e.sh.
import { defineSeoConfig } from 'crawler-visibility';
import type { RouteSeo } from 'crawler-visibility/vite';

export default defineSeoConfig({
  siteUrl: 'https://example.com/',
  siteName: 'Example',
  defaultImage: '/og.png',
});

export const routes: RouteSeo[] = [
  { path: '/', title: 'Example · Home', description: 'An example site built with crawler-visibility.' },
  { path: '/docs', title: 'Docs · Example', description: 'Documentation pages.', kind: 'article' },
];
