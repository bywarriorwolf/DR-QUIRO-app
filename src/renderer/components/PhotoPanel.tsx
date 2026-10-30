import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CircleAlert, FilePlus2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { ImportedPhoto } from '../../shared/ipc';
import { S } from '../../shared/strings';
import loader from '../assets/loader.png';
import { ProgressBar } from './ProgressBar';

export type Tab = 'inicial' | 'final';
export type ZoneNotice = 'max' | 'format' | null;

interface Props {
  tabs: Tab[];
  active: Tab;
  photos: ImportedPhoto[];
  tabErrors: Record<Tab, boolean>;
  notice: ZoneNotice;
  importing: { done: number; total: number } | null;
  onTab(tab: Tab): void;
  onDropFiles(files: File[]): void;
  onPick(): void;
  onReorder(photos: ImportedPhoto[]): void;
  onRemove(id: string): void;
}

const TAB_LABEL: Record<Tab, string> = { inicial: S.tabInicial, final: S.tabFinal };

function SortablePhoto({ photo, index, onRemove }: { photo: ImportedPhoto; index: number; onRemove(id: string): void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id });
  return (
    <div
      ref={setNodeRef}
      className={`tile${isDragging ? ' tile--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`${index + 1}. ${photo.name}`}
    >
      <img src={photo.thumbDataUrl} alt="" draggable={false} />
      <button
        type="button"
        className="tile__remove"
        aria-label={S.removePhoto}
        title={S.removePhoto}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={() => onRemove(photo.id)}
      >
        <Trash2 size={20} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export function PhotoPanel(p: Props) {
  const [dragOver, setDragOver] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Status tiles (uploading / max / format) sit at the end of the grid: keep them visible.
  const scrollRef = useRef<HTMLDivElement>(null);
  const statusShown = !!p.importing || !!p.notice;
  useEffect(() => {
    const el = scrollRef.current;
    if (statusShown && el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [statusShown, p.active]);

  // While photos are being added the zone/tab stop showing the 'missing' error.
  const missing = !p.importing && p.tabErrors[p.active] && p.photos.length === 0;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = p.photos.findIndex((x) => x.id === e.active.id);
    const to = p.photos.findIndex((x) => x.id === e.over!.id);
    if (from >= 0 && to >= 0) p.onReorder(arrayMove(p.photos, from, to));
  };

  const fileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const dropHandlers = {
    onDragOver: (e: DragEvent) => {
      if (!fileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) p.onDropFiles(files);
    },
  };

  let zoneClass = 'zone';
  if (p.photos.length === 0) zoneClass += ' zone--empty';
  if (missing || (!p.importing && p.photos.length === 0 && p.notice === 'format')) zoneClass += ' zone--error';
  if (p.photos.length > 0 && p.notice) zoneClass += ' zone--limit';
  if (dragOver) zoneClass += ' zone--over';

  return (
    <section className="photos">
      <div className="tabs" role="tablist">
        {p.tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={p.active === t}
            className={`tab${p.active === t ? ' tab--active' : ''}${p.tabErrors[t] && !(p.importing && p.active === t) ? ' tab--error' : ''}`}
            onClick={() => p.onTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div className={zoneClass} {...dropHandlers} data-testid="dropzone">
        {p.photos.length === 0 ? (
          p.importing ? (
            <div className="zone__center">
              <img className="loader" src={loader} alt="" draggable={false} />
              <div className="zone__uploading">{S.uploading}</div>
              <ProgressBar className="progress--small" fraction={p.importing.total ? p.importing.done / p.importing.total : 0} />
            </div>
          ) : p.notice === 'format' ? (
            <button type="button" className="zone__center zone__center--error zone__button" onClick={p.onPick}>
              <CircleAlert className="alert-icon" size={38} fill="currentColor" stroke="#fff" strokeWidth={2.2} />
              <div className="zone__error-text">{S.wrongFormatTitle}</div>
              <div className="zone__error-body">{S.wrongFormatBody}</div>
            </button>
          ) : missing ? (
            <button type="button" className="zone__center zone__center--error zone__button" onClick={p.onPick}>
              <CircleAlert className="alert-icon" size={38} fill="currentColor" stroke="#fff" strokeWidth={2.2} />
              <div className="zone__error-text">{p.active === 'inicial' ? S.missingAntes : S.missingDespues}</div>
            </button>
          ) : (
            <button type="button" className="zone__center zone__button" onClick={p.onPick}>
              <FilePlus2 className="drop-icon" size={34} strokeWidth={1.7} />
              <div className="zone__hint">{S.dropHere}</div>
            </button>
          )
        ) : (
          <div className="grid-scroll" ref={scrollRef}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={p.photos.map((x) => x.id)} strategy={rectSortingStrategy}>
                <div className="grid">
                  {p.photos.map((photo, i) => (
                    <SortablePhoto key={photo.id} photo={photo} index={i} onRemove={p.onRemove} />
                  ))}
                  {p.importing && (
                    <div className="tile tile--status">
                      <img className="loader loader--small" src={loader} alt="" draggable={false} />
                      <ProgressBar className="progress--tile" fraction={p.importing.total ? p.importing.done / p.importing.total : 0} />
                    </div>
                  )}
                  {!p.importing && p.notice === 'max' && <div className="tile tile--status tile--error">{S.maxPhotos}</div>}
                  {!p.importing && p.notice === 'format' && (
                    <div className="tile tile--status tile--error">
                      <span>{S.wrongFormatTitle}</span>
                      <span className="tile__small">{S.wrongFormatBody}</span>
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>
    </section>
  );
}
