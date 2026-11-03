import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PHOTOS, type ReportType } from '../shared/config';
import type { AuthStatus, ImportedPhoto, ImportResult } from '../shared/ipc';
import { formForSubmit, screenHasDraft, validateReport, type InjuryKey, type ReportForm as Form } from '../shared/report';
import { S } from '../shared/strings';
import { api } from './api';
import { Header } from './components/Header';
import { Modal, type ModalState } from './components/Modal';
import { PhotoPanel, type Tab, type ZoneNotice } from './components/PhotoPanel';
import { ReportForm } from './components/ReportForm';

const EMPTY_FORM: Form = {
  type: 'inicial',
  nombre: '',
  apellido: '',
  fechaInicial: null,
  fechaFinal: null,
  injuries: { tension: '', tendon: '', ligamento: '', otras: '' },
};

export function App() {
  const [auth, setAuth] = useState<AuthStatus>({ connected: false, userName: null, mock: false });
  const [connecting, setConnecting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [tab, setTab] = useState<Tab>('inicial');
  const [photos, setPhotos] = useState<Record<Tab, ImportedPhoto[]>>({ inicial: [], final: [] });
  const [useOriginal, setUseOriginal] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<Record<Tab, ZoneNotice>>({ inicial: null, final: null });
  const [importing, setImporting] = useState<{ tab: Tab; done: number; total: number } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);

  useEffect(() => {
    if (!confirmNew) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmNew(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmNew]);

  useEffect(() => {
    void api.authStatus().then(setAuth);
    const offAuth = api.onAuthChanged(setAuth);
    const offProgress = api.onProgress((e) => setModal((m) => (m?.kind === 'progress' ? { kind: 'progress', fraction: Math.max(m.fraction, e.fraction) } : m)));
    const offImport = api.onImportProgress((e) => setImporting((cur) => (cur ? { ...cur, ...e } : cur)));
    return () => {
      offAuth();
      offProgress();
      offImport();
    };
  }, []);

  const tabs: Tab[] = form.type === 'comparativo' ? ['inicial', 'final'] : ['inicial'];
  const activeTab: Tab = tabs.includes(tab) ? tab : 'inicial';
  const validation = useMemo(
    () => validateReport(form, { inicial: photos.inicial.length, final: photos.final.length }),
    [form, photos],
  );
  const errors = submitted ? validation.fields : {};
  const tabErrors = {
    inicial: submitted && validation.missingInicialPhotos,
    final: submitted && validation.missingFinalPhotos,
  };

  const showNotice = (t: Tab, n: ZoneNotice) => {
    setNotice((s) => ({ ...s, [t]: n }));
    clearTimeout(noticeTimer.current);
    if (n) noticeTimer.current = setTimeout(() => setNotice({ inicial: null, final: null }), 6000);
  };

  const addResult = (t: Tab, r: ImportResult) => {
    setPhotos((s) => ({ ...s, [t]: [...s[t], ...r.photos].slice(0, PHOTOS.maxPerTab) }));
    showNotice(t, r.rejected.length ? 'format' : null);
  };

  const importInto = async (t: Tab, run: () => Promise<ImportResult>, count: number) => {
    if (importing) return;
    if (photos[t].length + count > PHOTOS.maxPerTab) {
      showNotice(t, 'max');
      return;
    }
    const gen = generation.current;
    setImporting({ tab: t, done: 0, total: count });
    try {
      const r = await run();
      if (generation.current !== gen) {
        if (r.photos.length) void api.releasePhotos(r.photos.map((x) => x.id));
        return;
      }
      addResult(t, r);
    } finally {
      if (generation.current === gen) setImporting(null);
    }
  };

  const onDropFiles = (files: File[]) => {
    const t = activeTab;
    const paths = api.pathsForFiles(files);
    if (paths.length === 0) return showNotice(t, 'format');
    void importInto(t, () => api.importPhotos(paths.slice(0, 100)), paths.length);
  };

  const onPick = async () => {
    const t = activeTab;
    if (importing) return;
    if (photos[t].length >= PHOTOS.maxPerTab) return showNotice(t, 'max');
    const gen = generation.current;
    setImporting({ tab: t, done: 0, total: 0 });
    try {
      const r = await api.pickPhotos();
      if (generation.current !== gen) {
        if (r.photos.length) void api.releasePhotos(r.photos.map((x) => x.id));
        return;
      }
      const room = PHOTOS.maxPerTab - photos[t].length;
      if (r.photos.length > room) {
        void api.releasePhotos(r.photos.map((x) => x.id));
        showNotice(t, 'max');
      } else addResult(t, r);
    } finally {
      if (generation.current === gen) setImporting(null);
    }
  };

  // Ctrl/Cmd+O opens the file picker (also when the grid already has photos).
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void pickRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onRemove = (id: string) => {
    setPhotos((s) => ({ ...s, [activeTab]: s[activeTab].filter((x) => x.id !== id) }));
    setUseOriginal((s) => {
      if (s[id] !== true) return s;
      const next = { ...s };
      delete next[id];
      return next;
    });
    setNotice((s) => ({ ...s, [activeTab]: null }));
    void api.releasePhotos([id]); // removes only the app's temp copy, never the original
  };

  const onType = (type: ReportType) => {
    setForm((f) => ({ ...f, type }));
    if (type === 'inicial') setTab('inicial');
  };

  const connect = async () => {
    setConnecting(true);
    try {
      setAuth(await api.connect());
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setMenuOpen(false);
    setAuth(await api.disconnect());
  };

  const clearScreen = () => {
    generation.current += 1;
    const ids = [...photos.inicial, ...photos.final].map((p) => p.id);
    clearTimeout(noticeTimer.current);
    setForm(EMPTY_FORM);
    setTab('inicial');
    setPhotos({ inicial: [], final: [] });
    setUseOriginal({});
    setNotice({ inicial: null, final: null });
    setImporting(null);
    setSubmitted(false);
    setModal(null);
    setMenuOpen(false);
    setConfirmNew(false);
    // Drops the app's private temp copies only. The files the user picked stay on disk.
    if (ids.length) void api.releasePhotos(ids);
  };

  const requestNewReport = () => {
    const draft = screenHasDraft({
      form,
      photoCount: photos.inicial.length + photos.final.length,
      modalOpen: modal !== null,
      notice: notice.inicial !== null || notice.final !== null,
      importing: importing !== null,
      submitted,
    });
    if (draft) setConfirmNew(true);
    else clearScreen();
  };

  const create = useCallback(async () => {
    const gen = generation.current;
    setSubmitted(true);
    if (!validation.ok) {
      if (validation.missingInicialPhotos) setTab('inicial');
      else if (validation.missingFinalPhotos) setTab('final');
      return;
    }
    if (!auth.connected) {
      setModal({ kind: 'error', code: 'notConnected' });
      return;
    }
    setModal({ kind: 'progress', fraction: 0 });
    const chosen = [...photos.inicial, ...(form.type === 'comparativo' ? photos.final : [])];
    const res = await api.createReport({
      form: formForSubmit(form),
      inicial: photos.inicial.map((x) => x.id),
      final: form.type === 'comparativo' ? photos.final.map((x) => x.id) : [],
      useOriginal: chosen.filter((x) => useOriginal[x.id] === true).map((x) => x.id),
    });
    if (generation.current !== gen) return;
    if (res.ok) setModal({ kind: 'done', url: res.editUrl });
    else {
      setModal({ kind: 'error', code: res.code, detail: res.message });
      if (res.code === 'notConnected') {
        const status = await api.authStatus();
        if (generation.current === gen) setAuth(status);
      }
    }
  }, [validation, auth.connected, form, photos, useOriginal]);

  return (
    <div className="stage">
      <div className="shell">
        <div className="titlebar" aria-hidden="true">
          <div className="titlebar__drag" />
        </div>
        <div className={`app${menuOpen ? ' app--menu' : ''}`}>
          <Header
            auth={auth}
            connecting={connecting}
            menuOpen={menuOpen}
            onNewReport={requestNewReport}
            onConnect={connect}
            onToggleMenu={() => setMenuOpen((m) => !m)}
            onDisconnect={disconnect}
          />
          <main className="content">
            <PhotoPanel
              tabs={tabs}
              active={activeTab}
              photos={photos[activeTab]}
              tabErrors={tabErrors}
              notice={notice[activeTab]}
              importing={importing && importing.tab === activeTab ? importing : null}
              onTab={setTab}
              onDropFiles={onDropFiles}
              onPick={onPick}
              onReorder={(list) => setPhotos((s) => ({ ...s, [activeTab]: list }))}
              onRemove={onRemove}
              useOriginal={useOriginal}
              onToggleOriginal={(id) => setUseOriginal((s) => ({ ...s, [id]: s[id] !== true }))}
            />
            <ReportForm
              form={form}
              errors={errors}
              hasErrors={submitted && !validation.ok}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              onInjury={(k: InjuryKey, v) => setForm((f) => ({ ...f, injuries: { ...f.injuries, [k]: v } }))}
              onType={onType}
              onCreate={create}
            />
          </main>
          {menuOpen && <div className="menu-dim" onClick={() => setMenuOpen(false)} />}
          <Modal
            state={modal}
            onOpenDoc={(url) => void api.openReport(url)}
            onRetry={create}
            onClose={() => setModal(null)}
          />
          {confirmNew && (
            <div className="backdrop backdrop--top">
              <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-report-title">
                <div className="modal__title modal__title--ask" id="new-report-title">{S.newReportConfirm}</div>
                <div className="modal__actions">
                  <button type="button" className="pill-button pill-button--ghost" onClick={() => setConfirmNew(false)} autoFocus>
                    {S.pickerCancel}
                  </button>
                  <button type="button" className="pill-button" onClick={clearScreen}>
                    {S.startNew}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
