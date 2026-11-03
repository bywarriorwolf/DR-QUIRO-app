import { CANVA, PHOTOS, TEMPLATE, type ReportType } from './config';
import { formatReportDate, isValidDate, type DateParts } from './dates';

export type InjuryKey = 'tension' | 'tendon' | 'ligamento' | 'otras';
/** Order = order of the placeholders on page 11 (top to bottom). */
export const INJURY_KEYS: readonly InjuryKey[] = ['tension', 'tendon', 'ligamento', 'otras'];

export interface ReportForm {
  type: ReportType;
  nombre: string;
  apellido: string;
  fechaInicial: DateParts | null;
  fechaFinal: DateParts | null;
  injuries: Record<InjuryKey, string>;
}

export type FieldKey = 'nombre' | 'apellido' | 'fechaInicial' | 'fechaFinal' | InjuryKey;

export interface ValidationResult {
  ok: boolean;
  fields: Partial<Record<FieldKey, true>>;
  missingInicialPhotos: boolean;
  missingFinalPhotos: boolean;
}

/** Collapse whitespace; keeps the user's accents and capitalisation. */
export function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function fullName(form: Pick<ReportForm, 'nombre' | 'apellido'>): string {
  return cleanText(`${cleanText(form.nombre)} ${cleanText(form.apellido)}`);
}

export const BLANK_INJURIES: Record<InjuryKey, string> = {
  tension: '',
  tendon: '',
  ligamento: '',
  otras: '',
};

/**
 * Copy sent to the main process and on to Canva.
 * Comparativo keeps whatever the user typed in the form, but those four
 * strings are not part of the request: the Comparativo template has no
 * injury lines, and the fields are disabled.
 */
export function formForSubmit(form: ReportForm): ReportForm {
  if (form.type !== 'comparativo') return form;
  return { ...form, injuries: { ...BLANK_INJURIES } };
}

/** True when the screen is not the empty Reporte Inicial, so "Nuevo reporte" must ask first. */
export function screenHasDraft(s: {
  form: ReportForm;
  photoCount: number;
  modalOpen: boolean;
  notice: boolean;
  importing: boolean;
  submitted: boolean;
}): boolean {
  if (s.photoCount > 0 || s.modalOpen || s.notice || s.importing || s.submitted) return true;
  if (s.form.type !== 'inicial') return true;
  if (s.form.nombre !== '' || s.form.apellido !== '') return true;
  if (s.form.fechaInicial || s.form.fechaFinal) return true;
  return INJURY_KEYS.some((k) => (s.form.injuries[k] ?? '') !== '');
}

/**
 * Nombre, Apellidos and Fecha Inicial are always required.
 * The four injury fields are required only for Reporte Inicial.
 * Fecha Final (and the Final photo tab) are required only for Comparativo.
 * Photos: 1..21 on each tab the report type uses.
 */
export function validateReport(
  form: ReportForm,
  photoCounts: { inicial: number; final: number },
): ValidationResult {
  const fields: ValidationResult['fields'] = {};
  if (!cleanText(form.nombre)) fields.nombre = true;
  if (!cleanText(form.apellido)) fields.apellido = true;
  if (!form.fechaInicial || !isValidDate(form.fechaInicial)) fields.fechaInicial = true;
  if (form.type === 'comparativo') {
    if (!form.fechaFinal || !isValidDate(form.fechaFinal)) fields.fechaFinal = true;
  } else {
    for (const k of INJURY_KEYS) if (!cleanText(form.injuries[k] ?? '')) fields[k] = true;
  }
  const missingInicialPhotos = photoCounts.inicial < PHOTOS.minPerTab;
  const missingFinalPhotos = form.type === 'comparativo' && photoCounts.final < PHOTOS.minPerTab;
  const tooMany = photoCounts.inicial > PHOTOS.maxPerTab || photoCounts.final > PHOTOS.maxPerTab;
  const ok = Object.keys(fields).length === 0 && !missingInicialPhotos && !missingFinalPhotos && !tooMany;
  return { ok, fields, missingInicialPhotos, missingFinalPhotos };
}

/** "REPORTE INICIAL Ana Pérez - Julio 08, 2026 - A5" */
export function buildTitle(form: Pick<ReportForm, 'type' | 'nombre' | 'apellido' | 'fechaInicial'>): string {
  if (!form.fechaInicial) throw new Error('Falta la fecha inicial');
  return CANVA.titlePattern
    .replace('{TIPO}', CANVA.titleTypeWord[form.type])
    .replace('{Nombre}', cleanText(form.nombre))
    .replace('{Apellido}', cleanText(form.apellido))
    .replace('{Fecha}', formatReportDate(form.fechaInicial))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Name on the cover: "{Nombre} {Apellido}" in UPPERCASE (Spanish locale). */
export function coverName(form: Pick<ReportForm, 'nombre' | 'apellido'>): string {
  return fullName(form).toLocaleUpperCase('es');
}

export function coverDate(form: Pick<ReportForm, 'type' | 'fechaInicial' | 'fechaFinal'>): string {
  if (!form.fechaInicial) throw new Error('Falta la fecha inicial');
  if (form.type === 'comparativo') {
    if (!form.fechaFinal) throw new Error('Falta la fecha final');
    return `${formatReportDate(form.fechaInicial)} - ${formatReportDate(form.fechaFinal)}`;
  }
  return formatReportDate(form.fechaInicial);
}

/** Photo n (1-based) -> page (1-based) and row (0-based). */
export function slotForPhoto(n: number): { page: number; row: number } {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Número de foto inválido: ${n}`);
  const page = TEMPLATE.photoPages.first + Math.floor((n - 1) / TEMPLATE.rowsPerPage);
  if (page > TEMPLATE.photoPages.last) throw new Error(`Demasiadas fotos: ${n}`);
  return { page, row: (n - 1) % TEMPLATE.rowsPerPage };
}

/** Maximum photos the template can hold per column. */
export const TEMPLATE_CAPACITY =
  (TEMPLATE.photoPages.last - TEMPLATE.photoPages.first + 1) * TEMPLATE.rowsPerPage;
