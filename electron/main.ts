import { app, BrowserWindow, dialog, session } from 'electron'
import path from 'node:path'
import { openDatabase, closeDatabase } from './db/connection.ts'
import { registerIpcHandlers } from './ipc/handlers.ts'
import { stopParser } from './parser/service.ts'
import { onWatchUpdate, restartWatcher, scanAll, stopWatcher } from './watcher/watcher.ts'
import { initUpdater, checkForUpdate } from './update/updater.ts'

const DIST_ELECTRON = __dirname
const DIST = path.join(DIST_ELECTRON, '../dist')
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let win: BrowserWindow | null = null

/**
 * Окно не должно уходить на сторонние адреса и открывать новые.
 *
 * Preload выдаёт странице `window.api`, а он умеет читать произвольные файлы
 * (просмотр прайса, импорт). Если окно увести на внешнюю страницу, эти
 * возможности достанутся ей. Своих ссылок наружу в приложении нет, поэтому
 * запрещаем всё: понадобится — разрешим точечно.
 */
function lockDownNavigation(target: BrowserWindow): void {
  const allowedOrigin = DEV_SERVER_URL ?? 'file://'

  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  target.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedOrigin)) event.preventDefault()
  })

  target.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

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
      // Preload обходится одним `electron` — Node ему не нужен, значит и
      // послаблять песочницу не за чем.
      sandbox: true,
    },
  })

  lockDownNavigation(win)

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

  // Приложению не нужны ни камера, ни геолокация, ни уведомления — отказываем
  // всему сразу, чтобы запрос не мог появиться неожиданно.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })

  registerIpcHandlers()
  createWindow()

  // Проверка обновлений при запуске — только проверка: она отмечает ссылку в
  // подвале, а скачивание остаётся за человеком.
  initUpdater((state) => win?.webContents.send('update:state', state))
  void checkForUpdate()

  // Наблюдатель шлёт состояние в окно сам: импорт может случиться и без
  // участия пользователя, и экран должен это показать.
  onWatchUpdate((state) => win?.webContents.send('watch:update', state))
  restartWatcher()
  void scanAll().catch((err: Error) => {
    console.error('Обход папок при запуске не удался:', err.message)
  })

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

/**
 * Отказ промиса, который никто не поймал, по умолчанию завершает процесс. Для
 * фонового наблюдателя это означало бы, что приложение молча закрывается из-за
 * одного битого файла в папке. Логируем и живём дальше.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Необработанный отказ промиса:', reason)
})
