import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    cli: 'src/cli.tsx',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  dts: false,
  banner: { js: '#!/usr/bin/env node' },
})
