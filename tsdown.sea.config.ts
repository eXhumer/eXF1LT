import { fileURLToPath } from 'node:url'

import { defineConfig } from 'tsdown'

/**
 * One self-contained ESM file for the single executable: a SEA main can only
 * import Node built-ins, so every dependency is bundled in.
 */
export default defineConfig({
  entry: {
    exf1lt: 'src/cli.tsx',
  },
  outDir: 'dist-sea',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  dts: false,
  deps: {
    alwaysBundle: [/.*/],
  },
  // Ink only loads react-devtools-core when DEV=true; nothing to bundle for it.
  alias: {
    'react-devtools-core': fileURLToPath(new URL('./scripts/empty-module.js', import.meta.url)),
  },
  outputOptions: {
    codeSplitting: false,
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})
