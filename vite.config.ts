/// <reference types="vitest/config" />
import path from 'node:path'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    { enforce: 'pre', ...mdx({ providerImportSource: '@mdx-js/react', remarkPlugins: [remarkGfm] }) },
    react({ include: /\.(jsx|js|mdx|md|tsx|ts)$/ }),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // three.js (~900 kB) is split into its own chunk and only loaded by the 3D modules.
  // The manifest lets scripts/postbuild.mjs write per-route HTML with preload hints.
  build: { chunkSizeWarningLimit: 1000, manifest: true },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Some engine tests simulate hours of flight; CI runners are slower than a laptop.
    testTimeout: 30_000,
  },
})
