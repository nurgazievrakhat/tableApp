import type {
  SheetSummary, SheetPreview, CandidateInfo, SheetWindow,
} from '../electron/parser/protocol.ts'
import type { ColumnMap, Field } from '../electron/parser/columns.ts'
import type { ColumnCheck } from '../electron/parser/validate.ts'
import type {
  Supplier, SupplierDetails, SupplierProfile,
} from '../electron/db/repo/suppliers.ts'
import type { BackupInfo, BackupState } from '../electron/db/backup.ts'
import type { Mapping, MappingLookup, SaveMappingInput } from '../electron/db/repo/mappings.ts'
import type { ImportResult } from '../electron/db/repo/imports.ts'
import type {
  SearchQuery, SearchResult, SearchHit, Correction, ProductGroup, GroupedResult,
} from '../electron/db/repo/search.ts'
import type { LinkStats, MatchSuggestion } from '../electron/db/repo/products.ts'
import type {
  ItemDetail, PriceChange, ChangesQuery, ChangesReport, ChangeRow,
} from '../electron/db/repo/history.ts'
import type { Source, SourceStatus } from '../electron/db/repo/sources.ts'
import type { WatchState, WatchedFolder } from '../electron/watcher/watcher.ts'
import type { PendingFile, WatchEvent } from '../electron/watcher/pipeline.ts'

export type {
  SheetSummary, SheetPreview, CandidateInfo, ColumnMap, Field, SheetWindow, ColumnCheck,
  Supplier, SupplierDetails, SupplierProfile, BackupInfo, BackupState,
  Mapping, MappingLookup, SaveMappingInput, ImportResult,
  SearchQuery, SearchResult, SearchHit, Correction, Source, SourceStatus,
  ProductGroup, GroupedResult, LinkStats, MatchSuggestion,
  ItemDetail, PriceChange, ChangesQuery, ChangesReport, ChangeRow,
  WatchState, WatchedFolder, PendingFile, WatchEvent,
}

/** Итог импорта либо отказ, если файл с таким содержимым уже загружен. */
export type ImportOutcome =
  | { status: 'duplicate'; duplicateOf: string }
  | {
      status: 'done'
      /**
       * Позиции записаны, но пересобрать связи товаров не удалось. Сравнение по
       * поставщикам осталось прежним, поиск работает.
       */
      linkError: string | null
      result: ImportResult
      supplierName: string
      categories: string[]
      collisions: number
      priceDate: number | null
      priceDateSource: 'cell' | 'filename' | 'mtime' | 'none'
      skipReasons: Record<string, number>
    }

export interface DbStatus {
  path: string
  schemaVersion: number
  expectedVersion: number
  appliedNow: string[]
  sizeBytes: number
  tables: { name: string; rows: number }[]
}

export interface AppInfo {
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
}

export interface OpenedFile {
  path: string
  name: string
  sheets: SheetSummary[]
}

/** Всё, что renderer может вызвать в main. Расширяется по мере этапов. */
export interface Api {
  getDbStatus(): Promise<DbStatus>
  getAppInfo(): Promise<AppInfo>
  /** Диалог выбора файла. null — пользователь отменил. */
  pickPriceFile(): Promise<OpenedFile | null>
  openPriceFile(path: string): Promise<OpenedFile>
  readSheet(
    path: string,
    sheet: string,
    opts?: { headerRow?: number },
  ): Promise<SheetPreview>

  /** Окно строк листа для просмотра прайса. */
  readRows(
    path: string, sheet: string, from: number, count: number, headerRow?: number,
  ): Promise<SheetWindow>

  /** Список резервных копий базы и причина, если копию не удалось снять. */
  listBackups(): Promise<BackupState>
  /** Копия прямо сейчас, вне расписания. */
  backupNow(): Promise<BackupState>
  /** Заменяет базу копией и перезапускает приложение. */
  restoreBackup(name: string): Promise<void>
  openBackupsFolder(): Promise<void>

  listSuppliers(): Promise<Supplier[]>
  /** Поставщики с тем, что за ними числится — для управления. */
  supplierDetails(): Promise<SupplierDetails[]>
  renameSupplier(id: number, name: string): Promise<Supplier>
  /** Удаляет поставщика вместе с прайсами, позициями, историей и профилями. */
  removeSupplier(id: number): Promise<void>
  removeMapping(id: number): Promise<void>
  listMappings(): Promise<Mapping[]>
  /** Подбор сохранённого профиля по отпечатку заголовков и имени файла. */
  findMapping(signature: string | null, filename: string): Promise<MappingLookup>
  saveMapping(input: SaveMappingInput): Promise<Mapping>
  /** Разбор строк по профилю и запись в базу одной транзакцией. */
  runImport(path: string, sheet: string, mappingId: number): Promise<ImportOutcome>
  /** Поиск по всем импортированным прайсам сразу. */
  search(query: SearchQuery): Promise<SearchResult>
  /** Тот же поиск, но одной строкой на товар с предложениями всех поставщиков. */
  searchGrouped(query: SearchQuery & { onlyMulti?: boolean }): Promise<GroupedResult>
  /** Ручная склейка товаров, которые автоматика не связала. */
  mergeProducts(targetId: number, sourceIds: number[]): Promise<void>
  unmergeProduct(productId: number): Promise<void>
  /** Пересобрать связи товаров заново — например, после правки правил. */
  relinkProducts(): Promise<LinkStats>
  /** Возможные склейки для товара — считаются по требованию. */
  suggestMatches(productId: number): Promise<MatchSuggestion[]>

  /** Карточка позиции: все колонки прайса и история цены. */
  itemDetail(itemId: number): Promise<ItemDetail>
  /** Что подорожало и подешевело за период. */
  priceChanges(query: ChangesQuery): Promise<ChangesReport>

  /** Загруженные прайсы и их состояние на диске. */
  listSources(): Promise<Source[]>
  reimportSource(fileId: number): Promise<ImportOutcome>
  removeSource(fileId: number): Promise<void>

  /** Автоподхват прайсов из наблюдаемых папок. */
  watchState(): Promise<WatchState>
  addWatchFolder(): Promise<WatchState>
  removeWatchFolder(id: number): Promise<WatchState>
  toggleWatchFolder(id: number, enabled: boolean): Promise<WatchState>
  rescanFolders(): Promise<WatchState>
  clearPending(file: string): Promise<WatchState>
  /** Подписка на изменения; возвращает функцию отписки. */
  onWatchUpdate(cb: (state: WatchState) => void): () => void
}
