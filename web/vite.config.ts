import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.BACKEND_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  // noVNC uses top-level await
  build: { target: 'es2022', outDir: 'dist', sourcemap: true },
  optimizeDeps: { exclude: ['@novnc/novnc'] },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/vnc': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
});
