import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: path.resolve('src/renderer'),
  build: {
    outDir: path.resolve('dist/renderer'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome120',
  },
});
