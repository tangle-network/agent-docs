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
  // `typescript` is a peer, loaded from the target repo at runtime.
  external: ['typescript'],
})
