import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import { notBundle } from 'vite-plugin-electron/plugin'
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
          plugins: [
            // Auto-externalize CJS/native npm packages (better-sqlite3, pdfmake, etc.) so
            // they're `require(...)`'d from node_modules/ at runtime instead of bundled
            // inline. Scoped to this entry's own `vite.plugins`, NOT the top-level plugins
            // array — the top-level array is shared by the renderer/client build too, and
            // this plugin externalizing bare specifiers there broke the renderer entirely
            // (`Uncaught TypeError: Failed to resolve module specifier "react"` at runtime,
            // since a browser `<script type="module">` can't resolve bare npm-package
            // imports the way Node/electron-builder can). See vite-plugin-electron's own
            // docs — `vite.plugins`, not the root config's `plugins`.
            //
            // The `filter` here (not a separate build.rollupOptions.external) is
            // deliberate: notBundle() owns build.rolldownOptions.external on Vite 8+ and
            // combining it with a second, independently-set rollupOptions.external in the
            // same build produced a malformed external array
            // ("Expected (string | RegExp) but received Function" from Rolldown) —
            // `filter` is the one sanctioned way to override its default package.json-derived
            // set. pdfmake pulls in pdfkit/fontkit/tslib, whose mixed CJS/ESM shapes esbuild's
            // bundling mangles (tslib's `modules/index.js` ends up with an undefined
            // `.default`; pdfmake/fonts/Roboto.js's `__dirname` breaks under forced-ESM
            // output) — externalizing the whole `pdfmake/*` subpath space leaves
            // `require(...)` untouched so Node resolves it and its own deps normally.
            // `filter` must be an array of string/RegExp, not a function — Rolldown (Vite
            // 8's bundler) rejects a Function element inside the merged external array
            // ("Expected (string | RegExp) but received Function") once notBundle()'s
            // config() hook result gets merged with the rest of the build config.
            notBundle({
              filter: ['electron', 'better-sqlite3', 'zkteco-js', 'exceljs', '@supabase/supabase-js', 'ws', 'pdfmake', /^pdfmake\//],
            }),
            // NOT esmShim() here: electron/main.ts already has its own manual
            // __filename/__dirname polyfill (Object.defineProperty at the top of the
            // file) predating this plugin ever actually being scoped to this build.
            // Now that this vite.plugins array genuinely applies to main.ts (it didn't
            // before — see note above), esmShim() injects a second, colliding
            // `import { fileURLToPath } from "node:url"` / `import { dirname } from
            // "node:path"` into the same file, which Rolldown rejects as a duplicate
            // identifier. Pick one polyfill, not both — the manual one already works.
          ],
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
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  }
})
