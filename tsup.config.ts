import { defineConfig } from 'tsup'

export default defineConfig([
  // Widget: single IIFE bundle, minified, all deps inlined
  {
    entry: ['src/widget/index.ts'],
    format: ['iife'],
    globalName: 'DaRing',
    outDir: 'dist',
    minify: true,
    bundle: true,
    noExternal: [/.*/],
    platform: 'browser',
    outExtension: () => ({ js: '.widget.js' }),
  },
  // CLI: ESM, external deps
  {
    entry: ['src/cli/index.ts'],
    format: ['esm'],
    outDir: 'dist/cli',
    bundle: true,
    platform: 'node',
    target: 'node18',
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])
