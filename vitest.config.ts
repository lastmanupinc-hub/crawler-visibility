import { defineConfig } from 'vitest/config';

// Standalone config so the package's tests don't inherit a parent workspace's
// include globs when it lives inside a monorepo.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
