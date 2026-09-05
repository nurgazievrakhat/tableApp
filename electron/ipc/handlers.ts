import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import { getStatus } from '../db/connection.ts'
import { listSheets, readSheet, readRows } from '../parser/service.ts'
import {
  listSuppliers, findOrCreateSupplier, listSupplierDetails, renameSupplier, removeSupplier,
} from '../db/repo/suppliers.ts'
import { listMappings, findMapping, saveMapping, removeMapping } from '../db/repo/mappings.ts'
import { search, searchGrouped } from '../db/repo/search.ts'
import { getItemDetail, priceChanges } from '../db/repo/history.ts'
import { performImport } from '../import/run.ts'
import {
  pruneProducts, mergeProducts, unmergeProduct, linkProducts, suggestMatches,
} from '../db/repo/products.ts'
import {
  addFolder, removeFolder, setFolderEnabled,
  getState, scanAll, restartWatcher, clearPending, type WatchState,
} from '../watcher/watcher.ts'
import { listSources, getSource, removeSource, type Source } from '../db/repo/sources.ts'
import { invalidateVocabulary } from '../db/repo/spelling.ts'
import type {
  AppInfo, DbStatus, OpenedFile, SheetPreview,
  Supplier, Mapping, MappingLookup, SaveMappingInput, ImportOutcome,
  SearchQuery, SearchResult, GroupedResult, LinkStats, MatchSuggestion,
  ItemDetail, ChangesQuery, ChangesReport, SheetWindow, SupplierDetails,
} from '@shared/types'

async function describe(file: string): Promise<OpenedFile> {
  const { sheets } = await listSheets(file)
  return { path: file, name: path.basename(file), sheets }
}


/** Единая точка регистрации IPC. Renderer к базе напрямую не ходит (§3). */
export function registerIpcHandlers(): void {
  ipcMain.handle('db:status', (): DbStatus => getStatus())

  ipcMain.handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
  }))

  ipcMain.handle('parser:pick', async (e): Promise<OpenedFile | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Выберите прайс-лист',
      properties: ['openFile'],
      filters: [{ name: 'Таблицы Excel', extensions: ['xlsx', 'xls', 'xlsm', 'xlsb'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return describe(result.filePaths[0])
  })

  ipcMain.handle('parser:open', (_e, file: string): Promise<OpenedFile> => describe(file))

  ipcMain.handle(
    'parser:sheet',
    (_e, file: string, sheet: string, opts?: { headerRow?: number }): Promise<SheetPreview> =>
      readSheet(file, sheet, opts ?? {}),
  )

  ipcMain.handle(
    'parser:rows',
    (
      _e, file: string, sheet: string, from: number, count: number, headerRow?: number,
    ): Promise<SheetWindow> => readRows(file, sheet, from, count, headerRow),
  )

  ipcMain.handle('suppliers:list', (): Supplier[] => listSuppliers())
  ipcMain.handle('mapping:list', (): Mapping[] => listMappings())

  ipcMain.handle('suppliers:details', (): SupplierDetails[] => listSupplierDetails())

  ipcMain.handle('suppliers:rename', (_e, id: number, name: string): Supplier =>
    renameSupplier(id, name))

  ipcMain.handle('suppliers:remove', (_e, id: number): void => {
    removeSupplier(id)
    // Позиции ушли — товары без связей и словарь опечаток надо пересобрать.
    pruneProducts()
    invalidateVocabulary()
  })

  ipcMain.handle('mapping:remove', (_e, id: number): void => removeMapping(id))

  ipcMain.handle(
    'mapping:find',
    (_e, signature: string | null, filename: string): MappingLookup =>
      findMapping(signature, filename),
  )

  ipcMain.handle('mapping:save', (_e, input: SaveMappingInput): Mapping => {
    const supplier = findOrCreateSupplier(input.supplierName)
    return saveMapping(input, supplier.id)
  })

  ipcMain.handle('search:run', (_e, q: SearchQuery): SearchResult => search(q))

  ipcMain.handle(
    'search:grouped',
    (_e, q: SearchQuery & { onlyMulti?: boolean }): GroupedResult => searchGrouped(q),
  )

  ipcMain.handle('products:merge', (_e, targetId: number, sourceIds: number[]): void => {
    mergeProducts(targetId, sourceIds)
  })

  ipcMain.handle('products:unmerge', (_e, productId: number): void => {
    unmergeProduct(productId)
  })

  ipcMain.handle('products:relink', (): LinkStats => linkProducts())

  ipcMain.handle('item:detail', (_e, itemId: number): ItemDetail => getItemDetail(itemId))

  ipcMain.handle(
    'history:changes',
    (_e, q: ChangesQuery): ChangesReport => priceChanges(q),
  )

  ipcMain.handle(
    'products:suggest',
    (_e, productId: number): MatchSuggestion[] => suggestMatches(productId),
  )

  ipcMain.handle(
    'import:run',
    (_e, filePath: string, sheet: string, mappingId: number): Promise<ImportOutcome> =>
      performImport(filePath, sheet, mappingId),
  )

  ipcMain.handle('sources:list', (): Source[] => listSources())

  ipcMain.handle('sources:reimport', async (_e, fileId: number): Promise<ImportOutcome> => {
    const src = getSource(fileId)
    if (src.status === 'missing') {
      throw new Error(`Файл не найден на диске: ${src.path}`)
    }
    if (src.mappingId === null) {
      throw new Error(`У источника «${src.fileName}» нет профиля разметки`)
    }
    return performImport(src.path, src.sheet, src.mappingId)
  })

  ipcMain.handle('sources:remove', (_e, fileId: number): void => {
    removeSource(fileId)
    pruneProducts()
    invalidateVocabulary()
  })

  ipcMain.handle('watch:state', (): WatchState => getState())

  ipcMain.handle('watch:add', async (e): Promise<WatchState> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, {
      title: 'Папка, куда складываются прайсы',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (!res.canceled && res.filePaths.length > 0) {
      addFolder(res.filePaths[0])
      await scanAll()
    }
    return getState()
  })

  ipcMain.handle('watch:remove', (_e, id: number): WatchState => {
    removeFolder(id)
    return getState()
  })

  ipcMain.handle('watch:toggle', (_e, id: number, enabled: boolean): WatchState => {
    setFolderEnabled(id, enabled)
    return getState()
  })

  ipcMain.handle('watch:rescan', async (): Promise<WatchState> => {
    restartWatcher()
    await scanAll()
    return getState()
  })

  ipcMain.handle('watch:clearPending', (_e, file: string): WatchState => {
    clearPending(file)
    return getState()
  })
}
