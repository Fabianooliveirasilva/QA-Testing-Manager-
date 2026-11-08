import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  preview: { port: 4173, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
});
