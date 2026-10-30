import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PHOTOS, type ReportType } from '../shared/config';
import type { AuthStatus, ImportedPhoto, ImportResult } from '../shared/ipc';
import { validateReport, type InjuryKey, type ReportForm as Form } from '../shared/report';
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
  const [unreliable, setUnreliable] = useState<Record<string, boolean>>({});
  const [cutoutNotice, setCutoutNotice] = useState(false);
  const [notice, setNotice] = useState<Record<Tab, ZoneNotice>>({ inicial: null, final: null });
  const [importing, setImporting] = useState<{ tab: Tab; done: number; total: number } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    setImporting({ tab: t, done: 0, total: count });
    try {
      addResult(t, await run());
    } finally {
      setImporting(null);
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
    setImporting({ tab: t, done: 0, total: 0 });
    try {
      const r = await api.pickPhotos();
      const room = PHOTOS.maxPerTab - photos[t].length;
      if (r.photos.length > room) {
        void api.releasePhotos(r.photos.map((x) => x.id));
        showNotice(t, 'max');
      } else addResult(t, r);
    } finally {
      setImporting(null);
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

  const create = useCallback(async () => {
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
    const ids = [...photos.inicial, ...photos.final].map((x) => x.id);
    const res = await api.createReport({
      form,
      inicial: photos.inicial.map((x) => x.id),
      final: form.type === 'comparativo' ? photos.final.map((x) => x.id) : [],
      useOriginal: ids.filter((id) => useOriginal[id] === true),
      forceCutout: ids.filter((id) => useOriginal[id] === false),
    });
    if (res.ok) {
      if (res.unreliableIds.length) {
        setUnreliable((s) => ({ ...s, ...Object.fromEntries(res.unreliableIds.map((id) => [id, true])) }));
        setUseOriginal((s) => ({ ...s, ...Object.fromEntries(res.unreliableIds.map((id) => [id, true])) }));
        setCutoutNotice(true);
      }
      setModal({ kind: 'done', url: res.editUrl });
    }
    else {
      setModal({ kind: 'error', code: res.code, detail: res.message });
      if (res.code === 'notConnected') setAuth(await api.authStatus());
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
            unreliable={unreliable}
            cutoutNotice={cutoutNotice}
            onToggleOriginal={(id) => setUseOriginal((s) => ({ ...s, [id]: s[id] !== true ? true : false }))}
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
        </div>
      </div>
    </div>
  );
}
