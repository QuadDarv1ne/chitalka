import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // Pure-function tests only: parser helpers have no DOM dependencies.
    // Components (DOMParser, canvas, IndexedDB) stay out of unit tests.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
