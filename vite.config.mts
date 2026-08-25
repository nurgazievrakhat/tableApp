import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

const alias = { '@shared': path.resolve(import.meta.dirname, 'shared') }

export default defineConfig({
  resolve: { alias },
  plugins: [
    react(),
    electron({
      main: {
        // Две точки входа: сам main и процесс разбора таблиц (utilityProcess).
        entry: {
          main: 'electron/main.ts',
          'parser.worker': 'electron/parser/worker.ts',
        },
        vite: {
          resolve: { alias },
          build: {
            // Нативный модуль не бандлим — грузится из node_modules как есть.
            rolldownOptions: { external: ['better-sqlite3'] },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: { resolve: { alias } },
      },
    }),
  ],
})
