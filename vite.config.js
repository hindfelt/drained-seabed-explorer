import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { devGenerateApi } from './generator/dev-api.mjs';

export default defineConfig({
  plugins: [devGenerateApi()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        generate: resolve(import.meta.dirname, 'generate.html'),
      },
    },
  },
});
