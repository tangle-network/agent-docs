import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  sourcemap: false,
  // Keep Microsoft's compatibility package as one shared runtime dependency.
  external: ['@typescript/typescript6'],
})
