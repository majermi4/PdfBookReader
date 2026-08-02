import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves project sites below /<repository>/, while local and
  // non-GitHub deployments are served from the domain root.
  base: process.env.GITHUB_ACTIONS ? '/PdfBookReader/' : '/',
});
