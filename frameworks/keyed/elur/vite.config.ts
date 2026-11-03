import { defineConfig } from 'vite'
import elurPlugin from '@elurjs/vite-plugin-elur'

export default defineConfig({
  base: '/frameworks/keyed/elur/dist/',
  plugins: [elurPlugin({ compiler: true })],
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: '.',
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  server: {
    port: 8080,
    strictPort: true,
  },
  preview: {
    port: 8080,
    strictPort: true,
  },
})
