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
    rollupOptions: {
      input: {
        main: path.resolve('src/renderer/index.html'),
        xray: path.resolve('src/renderer/xray.html'),
      },
    },
  },
});
