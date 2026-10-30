/**
 * Electron main process: window, security hardening and IPC.
 * Every IPC payload is validated with zod (src/shared/ipc.ts) and every
 * handler checks that the sender is our own page.
 */
import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, session, shell, type IpcMainInvokeEvent } from 'electron';
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
import { McpCanvaSession, MockCanvaSession, type CanvaSession } from './canva/connection';
import { runReport } from './canva/runner';
import { EncryptedFileSecretStore } from './canva/secretStore';
import { errorCode, ModelMissingError } from './errors';
import { initLog, log } from './log';
import { BackgroundRemover } from './photos/bgremove';
import { renderReportPhotos } from './photos/pipeline';
import { PhotoStore } from './photos/store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL; // set by scripts/dev.mjs only
const MOCK = process.env.DRQUIRO_MOCK_CANVA === '1';
const DESIGN = { width: 1440, height: 1024 }; // Figma frame size; the UI is zoomed to fit

if (process.env.DRQUIRO_USER_DATA) app.setPath('userData', path.resolve(process.env.DRQUIRO_USER_DATA));

let win: BrowserWindow | null = null;
let photos: PhotoStore;
let canva: CanvaSession;
let remover: BackgroundRemover | null = null;
let busy = false;
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
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PNG / JPG', extensions: ['png', 'jpg', 'jpeg'] }],
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
      log(`report: ${req.form.type}, ${inicial.length}+${final.length} photos`);
      progress({ stage: 'photos', fraction: 0.02 });
      const rm = await getRemover();
        log('report: remover ready');
      const pngs = await renderReportPhotos({
        inicial,
        final,
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
      return { ok: false, code: errorCode(e) };
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

function fitZoom() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  win.webContents.setZoomFactor(Math.max(0.4, Math.min(w / DESIGN.width, h / DESIGN.height)));
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const scale = Math.min(1, (area.width * 0.92) / DESIGN.width, (area.height * 0.92) / DESIGN.height);
  win = new BrowserWindow({
    width: Math.round(DESIGN.width * scale),
    height: Math.round(DESIGN.height * scale),
    minWidth: 900,
    minHeight: 640,
    useContentSize: true,
    show: false,
    backgroundColor: '#ffffff',
    title: 'DR·QUIRO Reportes',
    autoHideMenuBar: true,
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
  win.webContents.on('did-finish-load', fitZoom);
  win.on('resize', fitZoom);
  win.once('ready-to-show', () => win?.show());
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
