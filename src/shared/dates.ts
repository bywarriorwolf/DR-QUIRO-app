import { MONTHS, MONTHS_SHORT, WEEKDAYS_SHORT } from './strings';

/** A calendar date without time zone (avoids off-by-one around midnight). */
export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function isValidDate(d: DateParts): boolean {
  if (!Number.isInteger(d.year) || !Number.isInteger(d.month) || !Number.isInteger(d.day)) return false;
  if (d.year < 1900 || d.year > 2200 || d.month < 1 || d.month > 12 || d.day < 1) return false;
  return d.day <= daysInMonth(d.year, d.month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday. */
export function weekday(d: DateParts): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function compareDates(a: DateParts, b: DateParts): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** Report format used in Canva: "Julio 08, 2026". */
export function formatReportDate(d: DateParts): string {
  if (!isValidDate(d)) throw new Error('Fecha inválida');
  return `${MONTHS[d.month - 1]} ${String(d.day).padStart(2, '0')}, ${d.year}`;
}

/** Comparativo cover: "Julio 08, 2026 - Octubre 02, 2026". */
export function formatReportRange(start: DateParts, end: DateParts): string {
  return `${formatReportDate(start)} - ${formatReportDate(end)}`;
}

/** Date field display in the app (Figma): "Mayo 4 del 2026". */
export function formatFieldDate(d: DateParts): string {
  return `${MONTHS[d.month - 1]} ${d.day} del ${d.year}`;
}

/** Date picker header (Figma): "Lun, Ago 17". */
export function formatPickerHeader(d: DateParts): string {
  return `${WEEKDAYS_SHORT[weekday(d)]}, ${MONTHS_SHORT[d.month - 1]} ${d.day}`;
}

/** "Agosto 2026" */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

export function todayParts(now = new Date()): DateParts {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}
