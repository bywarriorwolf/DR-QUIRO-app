/**
 * Pure "what to change" builder: given the editing state returned by
 * start-editing-transaction and the uploaded asset ids, produce the
 * perform-editing-operations batches. No I/O, fully unit-tested against the
 * real structure dumps of both templates (tests/canvaOps.test.ts).
 *
 * Slots are found at runtime (empty SHAPE richtexts of the slot size on the
 * photo pages) and each photo is inserted at the slot's *actual* rect, because
 * the templates are not perfectly uniform.
 */
import { TEMPLATE, type ReportType } from '../../shared/config';
import { buildTitle, coverDate, coverName, cleanText, INJURY_KEYS, slotForPhoto, type ReportForm } from '../../shared/report';
import type { EditBatch, EditOperation, EditingState, RichText } from './types';

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

export interface SlotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}
export interface PageSlots {
  pageIndex: number;
  pageId: string;
  left: SlotRect[]; // rows top -> bottom
  right: SlotRect[];
}

export const textOf = (r: RichText): string => r.regions.map((g) => g.text ?? '').join('');

function pageWidth(state: EditingState, pageIndex: number): number {
  const p = state.pages[pageIndex - 1];
  return p?.dimension?.width ?? TEMPLATE.pageSize.width;
}

function isSlot(r: RichText): boolean {
  const d = r.containerElement?.dimension;
  if (!d) return false;
  const tol = TEMPLATE.slotTolerance;
  return (
    r.containerElement.type !== 'TEXT' &&
    Math.abs(d.width - TEMPLATE.slotSize.width) <= tol &&
    Math.abs(d.height - TEMPLATE.slotSize.height) <= tol &&
    textOf(r).trim() === ''
  );
}

/** Slot rects of one photo page, split into left/right columns. */
export function findSlots(state: EditingState, pageIndex: number): PageSlots {
  const page = state.pages[pageIndex - 1];
  if (!page) throw new TemplateError(`Falta la página ${pageIndex}`);
  const half = pageWidth(state, pageIndex) / 2;
  const slots = state.richtexts
    .filter((r) => r.page_index === pageIndex && isSlot(r))
    .map((r) => ({ ...r.containerElement.position, ...r.containerElement.dimension }));
  const byTop = (a: SlotRect, b: SlotRect) => a.top - b.top;
  const left = slots.filter((s) => s.left + s.width / 2 < half).sort(byTop);
  const right = slots.filter((s) => s.left + s.width / 2 >= half).sort(byTop);
  if (left.length !== TEMPLATE.rowsPerPage || right.length !== TEMPLATE.rowsPerPage) {
    throw new TemplateError(
      `Página ${pageIndex}: se esperaban ${TEMPLATE.rowsPerPage}+${TEMPLATE.rowsPerPage} espacios de foto, hay ${left.length}+${right.length}`,
    );
  }
  return { pageIndex, pageId: page.page_id, left, right };
}

export interface CoverElements {
  nameId: string;
  dateId: string;
  datePlaceholder: string;
  dateText: string;
}

export function findCover(state: EditingState, type: ReportType): CoverElements {
  const onCover = state.richtexts.filter((r) => r.page_index === TEMPLATE.coverPage);
  const nameRe = new RegExp(`(^|\\s)${TEMPLATE.placeholders.name}(\\s|$)`);
  const names = onCover.filter((r) => nameRe.test(textOf(r)));
  const datePlaceholder = type === 'inicial' ? TEMPLATE.placeholders.dateInicial : TEMPLATE.placeholders.dateComparativo;
  const dates = onCover.filter((r) => textOf(r).trim() === datePlaceholder);
  if (names.length !== 1) throw new TemplateError(`Portada: se esperaba 1 texto "${TEMPLATE.placeholders.name}", hay ${names.length}`);
  if (dates.length !== 1) throw new TemplateError(`Portada: se esperaba 1 texto "${datePlaceholder}", hay ${dates.length}`);
  return {
    nameId: names[0].element_id,
    dateId: dates[0].element_id,
    datePlaceholder,
    /** Exact cover text, including trailing spaces Canva stored on the placeholder. */
    dateText: textOf(dates[0]),
  };
}

/**
 * Page 11 injury placeholders, top -> bottom (= INJURY_KEYS order).
 * Null when this template has none (the Comparativo closing page). A partial
 * set is a broken template and still throws.
 */
export function findInjuryFields(state: EditingState): { id: string; text: string }[] | null {
  const found = state.richtexts
    .filter((r) => r.page_index === TEMPLATE.injuryPage && TEMPLATE.placeholders.injury.test(textOf(r)))
    .sort((a, b) => a.containerElement.position.top - b.containerElement.position.top)
    .map((r) => ({ id: r.element_id, text: textOf(r) }));
  if (found.length === 0) return null;
  if (found.length !== INJURY_KEYS.length) {
    throw new TemplateError(`Página ${TEMPLATE.injuryPage}: se esperaban ${INJURY_KEYS.length} lesiones, hay ${found.length}`);
  }
  return found;
}

export interface BuildInput {
  form: ReportForm;
  /** Uploaded asset ids in photo order. */
  inicialAssets: string[];
  finalAssets: string[];
}

export function altText(kind: 'inicial' | 'final', n: number): string {
  return `${kind === 'inicial' ? 'Foto inicial' : 'Foto final'} ${n}`;
}

/** All edit batches for one report, in page order. */
export function buildEditBatches(state: EditingState, input: BuildInput): EditBatch[] {
  const { form, inicialAssets, finalAssets } = input;
  const type = form.type;
  if (state.pages.length !== TEMPLATE.pageCount) {
    throw new TemplateError(`Se esperaban ${TEMPLATE.pageCount} páginas, hay ${state.pages.length}`);
  }
  if (inicialAssets.length < 1) throw new TemplateError('Sin fotos iniciales');
  if (type === 'inicial' && finalAssets.length > 0) throw new TemplateError('El reporte inicial no lleva fotos finales');

  const batches: EditBatch[] = [];

  // Cover + title (page 1).
  const cover = findCover(state, type);
  batches.push({
    pageIndex: TEMPLATE.coverPage,
    operations: [
      { type: 'find_and_replace_text', element_id: cover.nameId, find_text: TEMPLATE.placeholders.name, replace_text: coverName(form) },
      { type: 'find_and_replace_text', element_id: cover.dateId, find_text: cover.dateText, replace_text: coverDate(form) },
      { type: 'update_title', title: buildTitle(form) },
    ],
  });

  // Photos (pages 4..10). Inicial n -> left column; Final n -> right column, same row.
  const perPage = new Map<number, EditOperation[]>();
  const slotsCache = new Map<number, PageSlots>();
  const slots = (page: number) => {
    let s = slotsCache.get(page);
    if (!s) slotsCache.set(page, (s = findSlots(state, page)));
    return s;
  };
  const place = (assets: string[], column: 'left' | 'right', kind: 'inicial' | 'final') => {
    assets.forEach((assetId, i) => {
      const n = i + 1;
      const { page, row } = slotForPhoto(n);
      const s = slots(page);
      const rect = s[column][row];
      const ops = perPage.get(page) ?? [];
      ops.push({
        type: 'insert_fill',
        page_id: s.pageId,
        asset_type: 'image',
        asset_id: assetId,
        alt_text: altText(kind, n),
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
      perPage.set(page, ops);
    });
  };
  place(inicialAssets, 'left', 'inicial');
  if (type === 'comparativo') place(finalAssets, 'right', 'final');
  for (const page of [...perPage.keys()].sort((a, b) => a - b)) {
    batches.push({ pageIndex: page, operations: perPage.get(page)! });
  }

  // Injuries on whichever template actually has the four placeholders.
  // Both report types require them in the form; Comparativo's page 11 does not,
  // so that closing page is left untouched.
  const fields = findInjuryFields(state);
  if (fields) {
    batches.push({
      pageIndex: TEMPLATE.injuryPage,
      operations: INJURY_KEYS.map((k, i) => ({
        type: 'find_and_replace_text' as const,
        element_id: fields[i].id,
        find_text: fields[i].text,
        replace_text: cleanText(form.injuries[k]),
      })),
    });
  }
  return batches;
}
