import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:6969';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5300,
    strictPort: true,
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  preview: { port: 5300, proxy: { '/api': { target: API_TARGET, changeOrigin: true } } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
