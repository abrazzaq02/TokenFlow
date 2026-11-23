
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

// GitHub Pages serves the app under /TokenFlow/; Netlify (netlify.toml sets VITE_BASE=/) serves it at the root.
export default defineConfig({
  base: process.env.VITE_BASE || '/TokenFlow/',
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5000',
    },
  },
});
