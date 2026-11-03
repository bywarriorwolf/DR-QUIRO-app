/**
 * Preload (sandboxed, CommonJS). Exposes a narrow, typed API on window.drquiro.
 * No Node or Electron objects leak to the page.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/channels';
import type { DrQuiroApi } from '../shared/ipc';

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: DrQuiroApi = {
  authStatus: () => ipcRenderer.invoke(IPC.authStatus),
  connect: () => ipcRenderer.invoke(IPC.authConnect),
  disconnect: () => ipcRenderer.invoke(IPC.authDisconnect),
  pathsForFiles: (files) => Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean),
  importPhotos: (paths) => ipcRenderer.invoke(IPC.photosImport, { paths }),
  pickPhotos: () => ipcRenderer.invoke(IPC.photosPick),
  releasePhotos: (ids) => ipcRenderer.invoke(IPC.photosRelease, { ids }),
  createReport: (req) => ipcRenderer.invoke(IPC.reportCreate, req),
  openReport: (url) => ipcRenderer.invoke(IPC.reportOpen, { url }),
  onProgress: (cb) => subscribe(IPC.progress, cb),
  onImportProgress: (cb) => subscribe(IPC.importProgress, cb),
  onAuthChanged: (cb) => subscribe(IPC.authChanged, cb),
};

contextBridge.exposeInMainWorld('drquiro', api);
