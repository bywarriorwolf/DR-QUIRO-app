import { describe, expect, it } from 'vitest';
import { compareDates, daysInMonth, formatFieldDate, formatPickerHeader, formatReportDate, isValidDate } from '../src/shared/dates';
import { createReportSchema, importSchema, openUrlSchema, releaseSchema } from '../src/shared/ipc';
import { buildTitle, coverDate, coverName, slotForPhoto, TEMPLATE_CAPACITY, validateReport } from '../src/shared/report';
import { makeForm } from './helpers';

describe('dates', () => {
  it('formats report dates like "Julio 08, 2026"', () => {
    expect(formatReportDate({ year: 2026, month: 7, day: 8 })).toBe('Julio 08, 2026');
    expect(formatReportDate({ year: 2026, month: 10, day: 2 })).toBe('Octubre 02, 2026');
  });
  it('formats the app field and picker header like the Figma', () => {
    expect(formatFieldDate({ year: 2026, month: 5, day: 4 })).toBe('Mayo 4 del 2026');
    expect(formatPickerHeader({ year: 2026, month: 8, day: 17 })).toBe('Lun, Ago 17');
  });
  it('validates calendar dates (leap years, month lengths)', () => {
    expect(isValidDate({ year: 2028, month: 2, day: 29 })).toBe(true);
    expect(isValidDate({ year: 2026, month: 2, day: 29 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 13, day: 1 })).toBe(false);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(compareDates({ year: 2026, month: 1, day: 2 }, { year: 2026, month: 1, day: 1 })).toBeGreaterThan(0);
  });
  it('refuses to format an invalid date', () => {
    expect(() => formatReportDate({ year: 2026, month: 2, day: 30 })).toThrow();
  });
});

describe('validateReport (spec rules)', () => {
  it('a complete Inicial report with 1 photo is valid; Final photos are not needed', () => {
    expect(validateReport(makeForm('inicial'), { inicial: 1, final: 0 }).ok).toBe(true);
  });
  it('Inicial: every field incl. the 4 injuries is required; whitespace counts as empty', () => {
    const f = makeForm('inicial', { nombre: '  ', apellido: '', fechaInicial: null, injuries: { tension: '', tendon: ' ', ligamento: '', otras: '' } });
    const r = validateReport(f, { inicial: 0, final: 0 });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.fields).sort()).toEqual(['apellido', 'fechaInicial', 'ligamento', 'nombre', 'otras', 'tendon', 'tension'].sort());
    expect(r.missingInicialPhotos).toBe(true);
    expect(r.missingFinalPhotos).toBe(false);
  });
  it('Comparativo: every field is required, including the 4 injuries, Fecha Final and Final photos', () => {
    const f = makeForm('comparativo', {
      fechaFinal: null,
      injuries: { tension: '', tendon: ' ', ligamento: '', otras: '' },
    });
    const r = validateReport(f, { inicial: 3, final: 0 });
    expect(r.ok).toBe(false);
    expect(r.fields).toEqual({ fechaFinal: true, tension: true, tendon: true, ligamento: true, otras: true });
    expect(r.missingInicialPhotos).toBe(false);
    expect(r.missingFinalPhotos).toBe(true);
  });
  it('Inicial does not require Fecha Final, even when it is empty or not a real date', () => {
    expect(validateReport(makeForm('inicial', { fechaFinal: null }), { inicial: 1, final: 0 }).ok).toBe(true);
    const invalid = validateReport(makeForm('inicial', { fechaFinal: { year: 2026, month: 2, day: 31 } }), { inicial: 1, final: 0 });
    expect(invalid.ok).toBe(true);
    expect(invalid.fields.fechaFinal).toBeUndefined();
  });
  it('more than 21 photos in a tab is invalid', () => {
    expect(validateReport(makeForm('inicial'), { inicial: 22, final: 0 }).ok).toBe(false);
    expect(validateReport(makeForm('comparativo'), { inicial: 21, final: 21 }).ok).toBe(true);
  });
});

describe('report text', () => {
  it('title, cover name and cover dates', () => {
    expect(buildTitle(makeForm('inicial'))).toBe('REPORTE INICIAL María José Peña Gómez - Julio 08, 2026 - A5');
    expect(coverName(makeForm('inicial'))).toBe('MARÍA JOSÉ PEÑA GÓMEZ');
    expect(coverDate(makeForm('comparativo'))).toBe('Julio 08, 2026 - Octubre 02, 2026');
  });
  it('photo n -> page/row; 21 photos fit, 22 do not', () => {
    expect(slotForPhoto(1)).toEqual({ page: 4, row: 0 });
    expect(slotForPhoto(4)).toEqual({ page: 5, row: 0 });
    expect(slotForPhoto(21)).toEqual({ page: 10, row: 2 });
    expect(TEMPLATE_CAPACITY).toBe(21);
    expect(() => slotForPhoto(22)).toThrow();
  });
});

describe('IPC schemas (zod)', () => {
  const id = '3f2b8a52-8d7e-4c1e-9d55-0b7f4f9a6c11';
  it('accepts a well-formed create request', () => {
    expect(createReportSchema.safeParse({ form: makeForm('inicial'), inicial: [id], final: [] }).success).toBe(true);
  });
  it('rejects non-uuid photo ids (no paths can be smuggled in)', () => {
    expect(createReportSchema.safeParse({ form: makeForm('inicial'), inicial: ['../../etc/passwd'], final: [] }).success).toBe(false);
    expect(releaseSchema.safeParse({ ids: ['C:\\Windows\\win.ini'] }).success).toBe(false);
  });
  it('rejects too many photos, overlong text and unknown report types', () => {
    expect(createReportSchema.safeParse({ form: makeForm('inicial'), inicial: Array(22).fill(id), final: [] }).success).toBe(false);
    expect(createReportSchema.safeParse({ form: makeForm('inicial', { nombre: 'x'.repeat(301) }), inicial: [id], final: [] }).success).toBe(false);
    expect(createReportSchema.safeParse({ form: { ...makeForm('inicial'), type: 'otro' }, inicial: [id], final: [] }).success).toBe(false);
  });
  it('import accepts 1-100 paths only', () => {
    expect(importSchema.safeParse({ paths: [] }).success).toBe(false);
    expect(importSchema.safeParse({ paths: Array(101).fill('/a.jpg') }).success).toBe(false);
  });
  it('only https canva.com URLs may be opened', () => {
    expect(openUrlSchema.safeParse({ url: 'https://www.canva.com/design/DAX/edit' }).success).toBe(true);
    for (const url of ['http://www.canva.com/x', 'https://canva.com.evil.io/x', 'file:///etc/passwd', 'javascript:alert(1)', 'https://evil.io/?canva.com']) {
      expect(openUrlSchema.safeParse({ url }).success, url).toBe(false);
    }
  });
});
