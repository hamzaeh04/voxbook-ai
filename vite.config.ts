/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { UserConfig } from 'vite'

const nodeRequire = createRequire(import.meta.url)

/**
 * esbuild auto-detects a Yarn Plug'n'Play manifest in ANY parent directory (e.g. a stray ~/.pnp.cjs)
 * and then fails to resolve ordinary node_modules packages while pre-bundling deps (e.g. epubjs -> d).
 * This plugin resolves bare imports with Node's own resolver so the project builds regardless.
 */
type EsbuildPlugin = NonNullable<NonNullable<NonNullable<UserConfig['optimizeDeps']>['esbuildOptions']>['plugins']>[number]
const resolveFromNodeModules: EsbuildPlugin = {
  name: 'resolve-from-node-modules',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData?.nodeFallback || args.kind === 'entry-point' || path.isAbsolute(args.path)) return undefined
      // Normal resolution first (keeps ESM "exports" conditions); only fall back if PnP got in the way.
      const normal = await build.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        namespace: args.namespace,
        pluginData: { nodeFallback: true },
      })
      if (!normal.errors.length) return normal
      try {
        const resolved = nodeRequire.resolve(args.path, { paths: [args.resolveDir] })
        return path.isAbsolute(resolved) ? { path: resolved } : undefined // skip Node built-ins
      } catch {
        return undefined
      }
    })
  },
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  optimizeDeps: { esbuildOptions: { plugins: [resolveFromNodeModules] } },
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environmentMatchGlobs: [['tests/web/**', 'jsdom']],
    setupFiles: ['tests/setup.ts'],
  },
})
