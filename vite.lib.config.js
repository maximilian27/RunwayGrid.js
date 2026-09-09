import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.js',
      name: 'RunwayGrid',
      formats: ['es', 'umd'],
      fileName: (format) => `runway-grid.${format === 'es' ? 'js' : 'umd.cjs'}`,
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
