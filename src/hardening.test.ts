import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditPage } from './audit.js';
import { crawlerVisibility } from './vitePlugin.js';

const page = (ld: string) => `<html><head><title>t</title><meta name="description" content="d">
<link rel="canonical" href="https://a.example/"><script type="application/ld+json">${ld}</script></head>
<body><h1>H</h1><p>${'word '.repeat(60)}</p><a href="/">home</a></body></html>`;

describe('person check is opt-in', () => {
  const html = page('{"@graph":[{"@type":"Person","@id":"https://a.example/#person"}]}');
  it('passes any site when no personId is given', () => {
    expect(auditPage(html).ok).toBe(true);
  });
  it('passes when the given personId is in the graph', () => {
    expect(auditPage(html, 'x', { personId: 'https://a.example/#person' }).ok).toBe(true);
  });
  it('fails when the given personId is absent', () => {
    const r = auditPage(html, 'x', { personId: 'https://b.example/#person' });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/Person/);
  });
  it('honours minChars', () => {
    expect(auditPage(html, 'x', { minChars: 10_000 }).ok).toBe(false);
  });
});

function runPlugin(routes: any[]) {
  const emitted: Record<string, string> = {};
  const bundle: any = { 'index.html': { type: 'asset', source: '<html><head></head><body><p>x</p></body></html>' } };
  const plugin: any = crawlerVisibility({ config: { siteUrl: 'https://a.example/', siteName: 'A' }, routes });
  plugin.generateBundle.call({ emitFile: (f: any) => { emitted[f.fileName] = f.source; }, warn: () => {} }, {}, bundle);
  return { home: String(bundle['index.html'].source), emitted };
}

describe('vite plugin output is safe', () => {
  it('cannot be broken out of the JSON-LD script by a title containing </script>', () => {
    const { home } = runPlugin([{ path: '/', title: 'x</script><script>alert(1)</script>', description: 'd' }]);
    const ld = home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
    expect(ld).not.toMatch(/</);
    expect(() => JSON.parse(ld)).not.toThrow();
    expect(home).not.toContain('<script>alert(1)');
  });
  it('escapes & in sitemap URLs', () => {
    const { emitted } = runPlugin([{ path: '/', title: 't', description: 'd' }, { path: '/a&b', title: 't', description: 'd' }]);
    expect(emitted['sitemap.xml']).toContain('a&amp;b');
  });
  it('emits one file per non-home route', () => {
    const { emitted } = runPlugin([{ path: '/', title: 't', description: 'd' }, { path: '/docs/', title: 't', description: 'd' }]);
    expect(Object.keys(emitted)).toContain('docs/index.html');
  });
});

describe('cv-audit CLI exit codes', () => {
  const bin = join(__dirname, '..', 'bin', 'cv-audit.mjs');
  const built = existsSync(join(__dirname, '..', 'dist', 'audit.js'));
  const run = (args: string[]) => { try { execFileSync('node', [bin, ...args], { stdio: 'pipe' }); return 0; } catch (e: any) { return e.status; } };
  it.skipIf(!built)('0 on a good page, 1 on an empty shell, 2 on bad input', () => {
    const d = mkdtempSync(join(tmpdir(), 'cv-'));
    writeFileSync(join(d, 'good.html'), page('{"@type":"WebSite"}'));
    expect(run([join(d, 'good.html')])).toBe(0);
    writeFileSync(join(d, 'bad.html'), '<html><body><div id="root"></div></body></html>');
    expect(run([join(d, 'bad.html')])).toBe(1);
    expect(run([join(d, 'missing')])).toBe(2);
    expect(run([])).toBe(2);
    expect(run([d, '--min', 'abc'])).toBe(2);
  });
});
