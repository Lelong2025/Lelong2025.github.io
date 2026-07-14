import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  // Multi-page application entries
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tapchi: resolve(__dirname, 'tapchi/index.html'),
        portal: resolve(__dirname, 'portal/index.html'),
        magazineLogin: resolve(__dirname, 'magazine/index.html'),
        magazineEditor: resolve(__dirname, 'magazine/editor.html'),
        magazinePublishing: resolve(__dirname, 'magazine/publishing.html'),
      },
    },
  },

  // Dev server config
  server: {
    port: 5173,
    open: true,
    // Proxy API calls to backend
    proxy: {
      '/api': {
        target: 'http://localhost:10000',
        changeOrigin: true,
      },
    },
  },

  // Resolve aliases for clean imports
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@tapchi': resolve(__dirname, 'src/tapchi'),
      '@magazine': resolve(__dirname, 'src/magazine'),
    },
  },
})
