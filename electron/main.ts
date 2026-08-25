import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import { openDatabase, closeDatabase } from './db/connection.ts'
import { registerIpcHandlers } from './ipc/handlers.ts'
import { stopParser } from './parser/service.ts'
import { onWatchUpdate, restartWatcher, scanAll, stopWatcher } from './watcher/watcher.ts'

const DIST_ELECTRON = __dirname
const DIST = path.join(DIST_ELECTRON, '../dist')
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'TableEasy',
    backgroundColor: '#eef0f4',
    webPreferences: {
      preload: path.join(DIST_ELECTRON, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(DIST, 'index.html'))
  }
}

app.whenReady().then(() => {
  try {
    openDatabase()
  } catch (err) {
    // Без базы приложение бессмысленно — честно падаем с понятным сообщением,
    // а не открываем пустое окно.
    dialog.showErrorBox(
      'Не удалось открыть базу данных',
      `${(err as Error).message}\n\nПриложение будет закрыто.`,
    )
    app.quit()
    return
  }

  registerIpcHandlers()
  createWindow()

  // Наблюдатель шлёт состояние в окно сам: импорт может случиться и без
  // участия пользователя, и экран должен это показать.
  onWatchUpdate((state) => win?.webContents.send('watch:update', state))
  restartWatcher()
  void scanAll()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopWatcher()
  stopParser()
  closeDatabase()
})
