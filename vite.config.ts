import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['sharp'],
    },
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['sharp'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart: ({ reload }) => reload(),
        vite: { build: { outDir: 'dist-electron' } },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 5173 },
});
