import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    // L3: full React client (packages/client) built as Electron renderer.
    // In dev, the main process loads ELECTRON_RENDERER_URL (Vite dev server at localhost:5173).
    // In prod, main process loads dist/renderer/index.html via file://.
    // VITE_API_URL is baked in so file:// renderer can reach the local Express server.
    root: resolve(__dirname, '../client'),
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, '../client/index.html'),
        },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, '../client/src'),
      },
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:3000'),
    },
  },
});
