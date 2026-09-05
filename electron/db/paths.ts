import { app } from 'electron'
import path from 'node:path'

/**
 * Пути к файлам базы вынесены отдельно, чтобы connection.ts и backup.ts могли
 * пользоваться ими, не импортируя друг друга по кругу.
 */
export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'data.db')
}

export function getBackupDir(): string {
  return path.join(app.getPath('userData'), 'backups')
}
