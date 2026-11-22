import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the same build works on GitHub Pages (/opencrew/) and locally.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
