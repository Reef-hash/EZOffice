import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import { notBundle, esmShim } from 'vite-plugin-electron/plugin'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  // Licensing config (EZOFFICE_LICENSING_API_URL / EZOFFICE_SUPABASE_URL /
  // EZOFFICE_SUPABASE_ANON_KEY) must be baked into the built app at compile
  // time, not read from a runtime .env — a packaged installer runs on a
  // customer's machine, which will never have a .env file. loadEnv reads the
  // developer's own .env (or CI secrets) from the repo root at build time;
  // `define` below substitutes them as literal strings into the compiled
  // main-process bundle. Same values for every installation (not per-customer
  // secrets), so baking them in is correct — same reasoning as the anon key
  // already being embedded in EZPos-Web's public frontend bundle.
  const env = loadEnv(mode, process.cwd(), 'EZOFFICE_')
  const licensingDefine = {
    'process.env.EZOFFICE_LICENSING_API_URL': JSON.stringify(env.EZOFFICE_LICENSING_API_URL),
    'process.env.EZOFFICE_SUPABASE_URL': JSON.stringify(env.EZOFFICE_SUPABASE_URL),
    'process.env.EZOFFICE_SUPABASE_ANON_KEY': JSON.stringify(env.EZOFFICE_SUPABASE_ANON_KEY),
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Electron main process
      electron({
        entry: 'electron/main.ts',
        vite: {
          define: licensingDefine,
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
                id === 'electron' || id === 'better-sqlite3' || id === 'zkteco-js' || id === 'pdfmake' || id.startsWith('pdfmake/') || id === 'exceljs' ||
                id === '@supabase/supabase-js' || id === 'ws',
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
  }
})
