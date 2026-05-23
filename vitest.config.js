import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

function resolveTypescriptRelativeImports() {
  return {
    name: 'resolve-typescript-relative-imports',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer && !path.isAbsolute(source)) return null;
      if (!source.startsWith('.') && !path.isAbsolute(source)) return null;
      const importerPath = (importer || '').split('?')[0];
      const base = path.isAbsolute(source)
        ? source
        : path.resolve(path.dirname(importerPath), source);
      const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveTypescriptRelativeImports()],
  test: {
    globals: false,
    setupFiles: ['test/setup/require-ts-resolution.cjs'],
    environmentMatchGlobs: [['test/renderer/**/*.test.ts', 'jsdom']],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/main/**/*.ts', 'src/preload.ts', 'src/renderer/js/**/*.ts'],
      exclude: [
        'src/renderer/js/main.ts',
        '**/*.d.ts',
        '**/dist/**',
        '**/node_modules/**',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
