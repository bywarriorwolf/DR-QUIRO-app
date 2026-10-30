// Kept free of imports so the sandboxed preload stays tiny.
/** IPC channel names (renderer -> main unless noted). */
export const IPC = {
  authStatus: 'auth:status',
  authConnect: 'auth:connect',
  authDisconnect: 'auth:disconnect',
  photosImport: 'photos:import',
  photosPick: 'photos:pick',
  photosRelease: 'photos:release',
  reportCreate: 'report:create',
  reportOpen: 'report:open',
  /** main -> renderer */
  progress: 'report:progress',
  importProgress: 'photos:import-progress',
  authChanged: 'auth:changed',
} as const;
