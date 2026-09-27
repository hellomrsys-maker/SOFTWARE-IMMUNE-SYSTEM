import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// node: 09 — Vite config for the SIS developer interface
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env['CONTROL_API_PORT'] ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
});
