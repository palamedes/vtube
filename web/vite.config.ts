import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';

// During `npm run dev` the pages talk to a running hub through this proxy.
const hub = process.env.VTUBE_HUB ?? 'http://127.0.0.1:8750';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        studio: fileURLToPath(new URL('./index.html', import.meta.url)),
        render: fileURLToPath(new URL('./render.html', import.meta.url)),
        sheet: fileURLToPath(new URL('./sheet.html', import.meta.url)),
      },
    },
  },
  server: {
    // Private characters (characters/private, gitignored) live outside web/.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL('../characters/private', import.meta.url))] },
    proxy: {
      '/api': hub,
      '/ws': { target: hub.replace(/^http/, 'ws'), ws: true },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
