import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setupDom.ts'],
    environmentMatchGlobs: [['**/*.{test,spec}.tsx', 'jsdom']],
  },
});
