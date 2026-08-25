import { contextBridge, ipcRenderer } from 'electron'
import type { Api, WatchState } from '@shared/types'

const api: Api = {
  getDbStatus: () => ipcRenderer.invoke('db:status'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  pickPriceFile: () => ipcRenderer.invoke('parser:pick'),
  openPriceFile: (path) => ipcRenderer.invoke('parser:open', path),
  readSheet: (path, sheet, opts) => ipcRenderer.invoke('parser:sheet', path, sheet, opts),
  readRows: (path, sheet, from, count, headerRow) =>
    ipcRenderer.invoke('parser:rows', path, sheet, from, count, headerRow),
  listSuppliers: () => ipcRenderer.invoke('suppliers:list'),
  listMappings: () => ipcRenderer.invoke('mapping:list'),
  findMapping: (signature, filename) => ipcRenderer.invoke('mapping:find', signature, filename),
  saveMapping: (input) => ipcRenderer.invoke('mapping:save', input),
  runImport: (path, sheet, mappingId) => ipcRenderer.invoke('import:run', path, sheet, mappingId),
  search: (query) => ipcRenderer.invoke('search:run', query),
  searchGrouped: (query) => ipcRenderer.invoke('search:grouped', query),
  mergeProducts: (targetId, sourceIds) => ipcRenderer.invoke('products:merge', targetId, sourceIds),
  unmergeProduct: (productId) => ipcRenderer.invoke('products:unmerge', productId),
  relinkProducts: () => ipcRenderer.invoke('products:relink'),
  suggestMatches: (productId) => ipcRenderer.invoke('products:suggest', productId),
  itemDetail: (itemId) => ipcRenderer.invoke('item:detail', itemId),
  priceChanges: (query) => ipcRenderer.invoke('history:changes', query),
  listSources: () => ipcRenderer.invoke('sources:list'),
  reimportSource: (fileId) => ipcRenderer.invoke('sources:reimport', fileId),
  removeSource: (fileId) => ipcRenderer.invoke('sources:remove', fileId),
  watchState: () => ipcRenderer.invoke('watch:state'),
  addWatchFolder: () => ipcRenderer.invoke('watch:add'),
  removeWatchFolder: (id) => ipcRenderer.invoke('watch:remove', id),
  toggleWatchFolder: (id, enabled) => ipcRenderer.invoke('watch:toggle', id, enabled),
  rescanFolders: () => ipcRenderer.invoke('watch:rescan'),
  clearPending: (file) => ipcRenderer.invoke('watch:clearPending', file),
  onWatchUpdate: (cb) => {
    const listener = (_e: unknown, state: WatchState) => cb(state)
    ipcRenderer.on('watch:update', listener)
    return () => ipcRenderer.off('watch:update', listener)
  },
}

contextBridge.exposeInMainWorld('api', api)
