import { defineConfig } from 'vite';
import { devGenerateApi } from './generator/dev-api.mjs';

export default defineConfig({
  plugins: [devGenerateApi()],
});
