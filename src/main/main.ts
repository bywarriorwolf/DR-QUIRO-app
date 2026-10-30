/**
 * Electron main process: window, security hardening and IPC.
 * Every IPC payload is validated with zod (src/shared/ipc.ts) and every
 * handler checks that the sender is our own page.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, session, shell, type BrowserWindowConstructorOptions, type IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL } from '../shared/config';
import {
  createReportSchema,
  importSchema,
  IPC,
  openUrlSchema,
  releaseSchema,
  type AuthStatus,
  type CreateReportResult,
  type ProgressEvent,
} from '../shared/ipc';
import { S } from '../shared/strings';
import { THEME, TITLE_BAR_HEIGHT } from '../shared/theme';
import { McpCanvaSession, MockCanvaSession, type CanvaSession } from './canva/connection';
import { runReport } from './canva/runner';
import { EncryptedFileSecretStore } from './canva/secretStore';
import { errorCode, ModelMissingError, publicErrorDetail } from './errors';
import { initLog, log } from './log';
import { BackgroundRemover } from './photos/bgremove';
import { renderReportPhotos } from './photos/pipeline';
import { PhotoStore } from './photos/store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL; // set by scripts/dev.mjs only
const MOCK = process.env.DRQUIRO_MOCK_CANVA === '1';
const DESIGN = { width: 1440, height: 1024 }; // Figma card; the UI is zoomed to fit
/** Card plus the caption strip above it. */
const SHELL = { width: DESIGN.width, height: DESIGN.height + TITLE_BAR_HEIGHT };
/** Opaque light caption. A transparent/mica client area painted as an empty black window on Windows. */
const OVERLAY_COLOR = '#ffffff';
const WINDOW_BACKGROUND = '#ffffff';

if (process.env.DRQUIRO_USER_DATA) app.setPath('userData', path.resolve(process.env.DRQUIRO_USER_DATA));

let win: BrowserWindow | null = null;
let photos: PhotoStore;
let canva: CanvaSession;
let remover: BackgroundRemover | null = null;
let busy = false;
/** sha256 of a slot PNG -> Canva asset id. A retry of the same photos does not upload again. */
const uploadedAssetIds = new Map<string, string>();
let lastMockDir: string | null = null;

function rendererIndex() {
  return path.join(__dirname, '../renderer/index.html');
}

function modelPath(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'models', MODEL.fileName),
    path.join(app.getAppPath(), 'resources', 'models', MODEL.fileName),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new ModelMissingError(`model not found in ${candidates.join(', ')}`);
  return found;
}

async function getRemover(): Promise<BackgroundRemover> {
  remover ??= await BackgroundRemover.create(modelPath());
  return remover;
}

/** Only our own page may call IPC handlers. */
function assertSender(e: IpcMainInvokeEvent) {
  const url = e.senderFrame?.url ?? '';
  const okFile = url.startsWith('file://') && fileURLToPath(url.split('#')[0].split('?')[0]) === rendererIndex();
  const okDev = !!DEV_URL && url.startsWith(DEV_URL);
  if (!win || e.sender !== win.webContents || !(okFile || okDev)) throw new Error('IPC sender not allowed');
}

function handle<T>(channel: string, fn: (e: IpcMainInvokeEvent, arg: unknown) => Promise<T> | T) {
  ipcMain.handle(channel, async (e, arg) => {
    assertSender(e);
    return fn(e, arg);
  });
}

function status(): AuthStatus {
  return { connected: canva.isConnected(), userName: canva.accountName(), mock: canva.mock };
}

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function registerIpc() {
  handle(IPC.authStatus, () => status());
  handle(IPC.authConnect, async () => {
    try {
      await canva.login();
      win?.focus();
      return status();
    } catch (e) {
      log(`login failed: ${(e as Error).message}`);
      win?.focus();
      return { ...status(), error: errorCode(e) };
    }
  });
  handle(IPC.authDisconnect, async () => {
    await canva.logout();
    return status();
  });
  handle(IPC.photosImport, async (_e, arg) => {
    const { paths } = importSchema.parse(arg);
    return photos.import(paths, (done, total) => send(IPC.importProgress, { done, total }));
  });
  handle(IPC.photosPick, async () => {
    const testList = MOCK ? process.env.DRQUIRO_TEST_PICK_FILE : undefined;
    if (testList) {
      // UI automation only (mock mode): the "dialog" returns the paths listed in this file.
      const paths = (await fs.readFile(testList, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean);
      return importWithDelay(paths);
    }
    const r = await dialog.showOpenDialog(win!, {
      title: S.pickPhotos,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: S.pickPhotosFilter, extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (r.canceled || r.filePaths.length === 0) return { photos: [], rejected: [] };
    return photos.import(r.filePaths.slice(0, 100), (done, total) => send(IPC.importProgress, { done, total }));
  });
  handle(IPC.photosRelease, async (_e, arg) => {
    const { ids } = releaseSchema.parse(arg);
    await photos.release(ids);
  });
  handle(IPC.reportCreate, async (_e, arg): Promise<CreateReportResult> => {
    const req = createReportSchema.parse(arg);
    if (busy) return { ok: false, code: 'unknown' };
    if (!canva.isConnected()) return { ok: false, code: 'notConnected' };
    busy = true;
    const progress = (e: ProgressEvent) => send(IPC.progress, e);
    try {
      const inicial = req.inicial.map((id) => photos.pathOf(id));
      const final = req.form.type === 'comparativo' ? req.final.map((id) => photos.pathOf(id)) : [];
      const wantOriginal = new Set(req.useOriginal ?? []);
      const inicialOriginal = req.inicial.map((id) => wantOriginal.has(id));
      const finalOriginal = (req.form.type === 'comparativo' ? req.final : []).map((id) => wantOriginal.has(id));
      log(`report: ${req.form.type}, ${inicial.length}+${final.length} photos`);
      progress({ stage: 'photos', fraction: 0.02 });
      const needsCutout = [...inicialOriginal, ...finalOriginal].some((chosen) => !chosen);
      const rm = needsCutout ? await getRemover() : null;
      log(rm ? 'report: remover ready' : 'report: original frames only, remover skipped');
      const pngs = await renderReportPhotos({
        inicial,
        final,
        inicialOriginal,
        finalOriginal,
        remover: rm,
        onProgress: (d, t) => {
          log(`report: photo ${d}/${t}`);
          progress({ stage: 'photos', fraction: 0.02 + 0.58 * (d / t) });
        },
      });
      if (MOCK) lastMockDir = await saveMockOutput(pngs);
      const res = await runReport(canva.tools(), {
        form: req.form,
        inicialPngs: pngs.inicial,
        finalPngs: pngs.final,
        assetCache: uploadedAssetIds,
        log,
        onProgress: (p) => {
          const f = p.total ? p.done / p.total : 1;
          const base = { upload: [0.6, 0.25], copy: [0.85, 0.03], edit: [0.88, 0.1], commit: [0.98, 0.02] }[p.stage];
          progress({ stage: p.stage, fraction: base[0] + base[1] * f });
        },
      });
      if (MOCK && lastMockDir && canva instanceof MockCanvaSession) {
        const applied = canva.server.applied.get(res.designId);
        await fs.writeFile(path.join(lastMockDir, 'ops.json'), JSON.stringify({ ...res, applied, calls: canva.server.calls.map((c) => c.name) }, null, 2));
      }
      progress({ stage: 'done', fraction: 1 });
      log(`report created ${res.designId}`);
      return { ok: true, editUrl: res.editUrl, designId: res.designId, title: res.title };
    } catch (e) {
      log(`report failed: ${(e as Error)?.stack ?? e}`);
      return { ok: false, code: errorCode(e), message: publicErrorDetail(e) };
    } finally {
      busy = false;
    }
  });
  handle(IPC.reportOpen, async (_e, arg) => {
    const { url } = openUrlSchema.parse(arg);
    if (MOCK) {
      // Dry run: show the generated slot PNGs + ops.json instead of a browser tab.
      log(`[mock] would open ${url}`);
      if (lastMockDir && process.env.DRQUIRO_MOCK_NO_OPEN !== '1') await shell.openPath(lastMockDir);
      return;
    }
    await shell.openExternal(url);
  });
}

/** Mock mode can slow imports down so the "Subiendo Archivos" state can be seen/screenshotted. */
async function importWithDelay(paths: string[]) {
  const delay = Number(process.env.DRQUIRO_MOCK_IMPORT_DELAY_MS ?? 0);
  return photos.import(paths, (done, total) => send(IPC.importProgress, { done, total }), delay);
}

/** Dry-run: keep the slot PNGs so they can be inspected. */
async function saveMockOutput(pngs: { inicial: Buffer[]; final: Buffer[] }): Promise<string> {
  const dir = path.join(app.getPath('userData'), 'mock-output', new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(dir, { recursive: true });
  for (const [kind, list] of Object.entries(pngs)) {
    await Promise.all(list.map((b, i) => fs.writeFile(path.join(dir, `${kind}-${String(i + 1).padStart(2, '0')}.png`), b)));
  }
  log(`[mock] slot PNGs in ${dir}`);
  return dir;
}

function overlayHeight(zoom: number): number {
  return Math.max(1, Math.round(TITLE_BAR_HEIGHT * zoom));
}

function fitZoom() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const zoom = Math.max(0.4, Math.min(w / SHELL.width, h / SHELL.height));
  win.webContents.setZoomFactor(zoom);
  // Keep the native caption buttons the same height as the CSS drag strip.
  try {
    if (process.platform === 'win32' || process.platform === 'linux') {
      win.setTitleBarOverlay({ color: OVERLAY_COLOR, symbolColor: THEME.green, height: overlayHeight(zoom) });
    } else if (process.platform === 'darwin') {
      const bar = TITLE_BAR_HEIGHT * zoom;
      win.setWindowButtonPosition({ x: Math.round(14 * zoom), y: Math.max(0, Math.round((bar - 14) / 2)) });
    }
  } catch (e) {
    log(`title bar overlay: ${(e as Error).message}`);
  }
}

function windowChrome(zoom: number): BrowserWindowConstructorOptions {
  const overlay = { color: OVERLAY_COLOR, symbolColor: THEME.green, height: overlayHeight(zoom) };
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      backgroundColor: WINDOW_BACKGROUND,
      transparent: false,
      trafficLightPosition: { x: Math.round(14 * zoom), y: Math.max(0, Math.round((TITLE_BAR_HEIGHT * zoom - 14) / 2)) },
    };
  }
  // Opaque window. titleBarStyle hidden keeps our buttons; the overlay is white
  // with the app's green symbols instead of the default dark caption bar.
  // Do not set transparent or backgroundMaterial: on Windows that leaves the
  // client area unpainted, so the app looks like an empty black frame.
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay,
    backgroundColor: WINDOW_BACKGROUND,
    transparent: false,
  };
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const scale = Math.min(1, (area.width * 0.92) / SHELL.width, (area.height * 0.92) / SHELL.height);
  win = new BrowserWindow({
    width: Math.round(SHELL.width * scale),
    height: Math.round(SHELL.height * scale),
    minWidth: 900,
    minHeight: 640 + TITLE_BAR_HEIGHT,
    useContentSize: true,
    show: false,
    title: S.appTitle,
    autoHideMenuBar: true,
    roundedCorners: true,
    thickFrame: true,
    ...windowChrome(scale),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  const reveal = () => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`renderer failed to load (${code}) ${desc} ${url}`);
    reveal();
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`renderer gone: ${details.reason}`);
  });
  win.webContents.on('did-finish-load', () => {
    fitZoom();
    reveal();
  });
  win.on('resize', fitZoom);
  win.once('ready-to-show', reveal);
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(rendererIndex());
}

app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  // The stock File / Edit / View menu is English. This app has its own header menu.
  Menu.setApplicationMenu(null);
  initLog(path.join(app.getPath('userData'), 'logs'));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // No remote content in the window: block every non-local request.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const local = u.startsWith('file://') || u.startsWith('data:') || u.startsWith('devtools://') || (!!DEV_URL && (u.startsWith(DEV_URL) || u.startsWith(DEV_URL.replace('http', 'ws'))));
    cb({ cancel: !local });
  });

  photos = await PhotoStore.create(app.getPath('temp'));
  if (MOCK) {
    canva = new MockCanvaSession({
      delayMs: Number(process.env.DRQUIRO_MOCK_DELAY_MS ?? 60),
      startConnected: process.env.DRQUIRO_MOCK_CONNECTED !== '0',
      failTool: process.env.DRQUIRO_MOCK_FAIL_TOOL || undefined,
    });
  } else {
    const store = new EncryptedFileSecretStore(path.join(app.getPath('userData'), 'canva-auth.bin'), safeStorage);
    canva = new McpCanvaSession(store, (url) => shell.openExternal(url), log);
    void canva.resume().then((ok) => {
      log(`canva resume: ${ok ? 'connected' : 'not connected'}`);
      send(IPC.authChanged, status());
    });
  }
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  void photos?.dispose();
});
