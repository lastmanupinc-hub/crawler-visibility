#!/usr/bin/env bash
# Installs the packed tarball into a throwaway Vite project, builds an example config, and audits the output.
set -euo pipefail
ROOT=$(pwd); TGZ=$(ls -t "$ROOT"/crawler-visibility-*.tgz | head -1)
W=$(mktemp -d); cd "$W"
echo '{"name":"e2e","private":true,"type":"module"}' > package.json
npm i --silent -D vite@6 typescript@5 "$TGZ"
cat > index.html <<'H'
<!doctype html><html><head><meta charset="utf-8"></head><body><main><h1>Static content</h1>
<p>This paragraph is in the raw HTML, so crawlers that do not run JavaScript can read it. It is deliberately long enough to pass the default two hundred character threshold that the audit applies to every page it checks.</p><a href="/">Home</a></main></body></html>
H
mkdir tpl && cp "$ROOT"/scripts/fixtures/*.ts tpl/
echo '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noEmit":true,"skipLibCheck":true,"target":"ES2022"},"include":["tpl/*.ts"]}' > tsconfig.json
npx tsc -p .
for t in example; do
  printf "import { defineConfig } from 'vite'; import { crawlerVisibility } from 'crawler-visibility/vite'; import c, { routes } from './tpl/%s.seo.config';\nexport default defineConfig({ build: { outDir: 'out-%s' }, plugins: [crawlerVisibility({ config: c, routes })] });\n" "$t" "$t" > vite.config.ts
  npx vite build --logLevel error
  npx cv-audit "out-$t"
done
# Negative case: an empty SPA shell must fail with exit 1
mkdir -p shell && echo '<html><head><title>x</title></head><body><div id="root"></div></body></html>' > shell/index.html
set +e; npx cv-audit shell >/dev/null; rc=$?; set -e
[ "$rc" = 1 ] || { echo "expected exit 1 on empty shell, got $rc"; exit 1; }
# v0.3 CLIs
npx cv-robots --site https://e2e.example --ai search-only > robots.txt && npx cv-robots --check robots.txt
npx cv-sitemap --site https://e2e.example / /docs > sm.xml && npx cv-sitemap --check sm.xml --host e2e.example
set +e; npx cv-sitemap --check sm.xml --host other.example >/dev/null; rc=$?; set -e
[ "$rc" = 1 ] || { echo "expected cross-host sitemap to fail, got $rc"; exit 1; }
set +e; npx cv-audit out-example --grade >/dev/null 2>&1; rc=$?; set -e
[ "$rc" = 2 ] || { echo "expected --grade on a dir to be a usage error, got $rc"; exit 1; }
set +e; npx cv-audit http://127.0.0.1:1/ --grade >/dev/null 2>&1; rc=$?; set -e
[ "$rc" = 2 ] || { echo "expected unreachable --grade to exit 2, got $rc"; exit 1; }
echo 'not a url' > bad.txt; set +e; npx cv-sitemap --urls bad.txt --out sm >/dev/null 2>&1; rc=$?; set -e
[ "$rc" = 2 ] || { echo "expected bad URL list to exit 2, got $rc"; exit 1; }
# v0.4: SSRF guard, markdown, output-path safety
set +e; npx cv-audit http://127.0.0.1:9/ >/dev/null 2>&1; rc=$?; set -e
[ "$rc" = 2 ] || { echo "expected private URL to be refused (exit 2), got $rc"; exit 1; }
npx cv-audit out-example --markdown | grep -q "pages readable without JavaScript"
printf 'https://a.example/\nhttp://[::1]:8080/x\n' > hosts.txt && npx cv-sitemap --urls hosts.txt --out smout >/dev/null
[ -f smout/a.example/sitemap.xml ] && [ -z "$(find . -maxdepth 1 -name 'sitemap.xml')" ] || { echo "sitemap writer escaped its --out dir"; exit 1; }
echo "e2e: example built and passed; empty shell correctly failed"
