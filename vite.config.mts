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
            // Не бандлим: better-sqlite3 — нативный модуль, а electron-updater
            // читает свои файлы из ресурсов приложения и ломается в бандле.
            // Оба грузятся из node_modules как есть.
            rolldownOptions: { external: ['better-sqlite3', 'electron-updater'] },
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
