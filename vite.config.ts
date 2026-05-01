import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  server: {
    watch: {
      // Don't watch runtime artefacts — codex writes to ~/.codex-home,
      // libsql writes WAL/SHM next to harness.db, ccc writes to
      // .cocoindex_code, simple-git writes to data/repos/. Each touch
      // would otherwise trigger a `(ssr) page reload` and the browser
      // ends up in a navigation loop.
      ignored: [
        '**/data/**',
        '**/.cocoindex_code/**',
        '**/.codex/**',
        '**/codex-home/**',
        '**/node_modules/**',
        '**/.git/**',
      ],
    },
  },
})

export default config
