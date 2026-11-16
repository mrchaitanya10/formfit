import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// A relative base lets the built site run from any path (for example GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [tailwindcss(), react()],
});
