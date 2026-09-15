import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The demo/doc site is a plain multi-page site (no bundler-driven routing): each example is
// its own standalone HTML file under demo/examples/. Vite only includes demo/index.html in a
// production build by default, so every extra page must be listed explicitly here, otherwise
// `npm run build` (used for the GitHub Pages deployment) would silently drop them.
const page = (relativePath) => fileURLToPath(new URL(`demo/${relativePath}`, import.meta.url));

export default defineConfig({
  root: 'demo',
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: page('index.html'),
        example01: page('examples/01-vertical-list.html'),
        example02: page('examples/02-grid-2d.html'),
        example03: page('examples/03-horizontal-list.html'),
        example04: page('examples/04-infinite-vertical.html'),
        example05: page('examples/05-infinite-horizontal.html'),
        example06: page('examples/06-sliding-vertical.html'),
        example07: page('examples/07-sliding-horizontal.html'),
      },
    },
  },
});
