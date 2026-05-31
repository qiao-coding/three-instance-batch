import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig(({ command }) => {
  if (command === 'serve') {
    return {
      root: './demo/city-cluster-1',
      server: { open: true },
    }
  }
  return {
    build: {
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'ThreeInstanceBatch',
        fileName: 'three-instance-batch',
        formats: ['es'],
      },
      rollupOptions: {
        external: ['three'],
        output: {
          globals: { three: 'THREE' },
        },
      },
      outDir: './dist',
      emptyOutDir: true,
    },
  }
})
