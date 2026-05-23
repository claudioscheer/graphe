import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: path.resolve('src/renderer'),
  publicDir: path.resolve('assets'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve('dist/renderer'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome120',
    rollupOptions: {
      input: {
        main: path.resolve('src/renderer/index.html'),
      },
    },
  },
});
