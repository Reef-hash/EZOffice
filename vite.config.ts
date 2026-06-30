import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import { notBundle, esmShim } from 'vite-plugin-electron/plugin'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Electron main process
    electron({
      entry: 'electron/main.ts',
      vite: {
        build: {
          rollupOptions: {
            // pdfmake pulls in pdfkit/fontkit/tslib, whose mixed CJS/ESM shapes esbuild's
            // bundling mangles (tslib's `modules/index.js` ends up with an undefined
            // `.default`; pdfmake/fonts/Roboto.js's `__dirname` breaks under forced-ESM
            // output). Externalizing the whole `pdfmake/*` subpath space leaves
            // `require(...)` untouched so Node resolves it and its own deps normally at
            // runtime — same reason better-sqlite3 is external here. A plain string in
            // Rollup's `external` only matches that exact specifier, not subpaths, so this
            // needs the function form to also catch `pdfmake/fonts/Roboto.js`.
            external: (id) =>
              id === 'electron' || id === 'better-sqlite3' || id === 'zkteco-js' || id === 'pdfmake' || id.startsWith('pdfmake/'),
          },
        },
      },
    }),
    // Electron preload script
    electron({
      entry: 'electron/preload.ts',
      vite: {
        build: {
          rollupOptions: {
            external: ['electron'],
          },
        },
      },
    }),
    // Auto-externalize CJS npm packages (like better-sqlite3) so native .node
    // binaries are loaded from node_modules/ instead of bundled inline.
    notBundle(),
    // Auto-inject __filename/__dirname shim for files that reference them.
    esmShim(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
