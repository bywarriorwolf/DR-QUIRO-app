import { describe, expect, it } from 'vitest';
import { CANVA, TEMPLATE } from '../src/shared/config';
import comparativo from '../src/main/canva/fixtures/comparativo_structure.json' with { type: 'json' };
import inicial from '../src/main/canva/fixtures/inicial_structure.json' with { type: 'json' };
import { MockCanva } from '../src/main/canva/mock';
import { buildEditBatches, findCover, findInjuryFields, findSlots, textOf, TemplateError } from '../src/main/canva/ops';
import { parseEditingState } from '../src/main/canva/parse';
import { assertEditable, runReport } from '../src/main/canva/runner';
import type { EditingState } from '../src/main/canva/types';
import { makeForm, pngs } from './helpers';

const stateOf = (j: unknown): EditingState =>
  parseEditingState('start-editing-transaction', { content: [{ type: 'text', text: JSON.stringify(j) }] });
const INI = stateOf(inicial);
const COMP = stateOf(comparativo);

describe('slot detection on the real templates', () => {
  for (const [name, st] of [['inicial', INI], ['comparativo', COMP]] as const) {
    it(`${name}: 3+3 slots on every photo page, rows ordered, columns split`, () => {
      for (let p = TEMPLATE.photoPages.first; p <= TEMPLATE.photoPages.last; p++) {
        const s = findSlots(st, p);
        expect(s.left).toHaveLength(3);
        expect(s.right).toHaveLength(3);
        for (const col of [s.left, s.right]) {
          expect(col[0].top).toBeLessThan(col[1].top);
          expect(col[1].top).toBeLessThan(col[2].top);
        }
        expect(Math.max(...s.left.map((r) => r.left))).toBeLessThan(TEMPLATE.pageSize.width / 2);
        expect(Math.min(...s.right.map((r) => r.left))).toBeGreaterThan(TEMPLATE.pageSize.width / 2);
      }
    });
  }
  it('uses the actual (irregular) rects, e.g. Inicial page 9 and Comparativo page 9', () => {
    expect(findSlots(INI, 9).right.some((r) => Math.abs(r.top - 101.26) < 0.01)).toBe(true);
    expect(findSlots(COMP, 9).left.some((r) => Math.abs(r.left - 45.63) < 0.01)).toBe(true);
  });
  it('rejects a page without slots (page 3 has other shapes)', () => {
    expect(() => findSlots(INI, 3)).toThrow(TemplateError);
  });
});

describe('cover and injuries', () => {
  it('finds the name and date placeholders on both covers', () => {
    const a = findCover(INI, 'inicial');
    const b = findCover(COMP, 'comparativo');
    expect(a.datePlaceholder).toBe('Mes DD, AAAA');
    expect(b.datePlaceholder).toBe('Mes DD, AAAA - Mes DD, AAAA');
    const nameText = textOf(INI.richtexts.find((r) => r.element_id === a.nameId)!);
    expect(nameText).toContain('NOMBRE');
  });
  it('Inicial page 11 has 4 placeholders in top order', () => {
    const f = findInjuryFields(INI);
    expect(f?.map((x) => x.text)).toEqual(['Tension aquí', 'Lesion aquí', 'Lesion aquí', 'Lesion aquí']);
  });
  it('Comparativo page 11 has no injury placeholders', () => {
    expect(findInjuryFields(COMP)).toBeNull();
  });
});

describe('buildEditBatches', () => {
  it('Inicial with 21 photos: cover, 7 photo pages (left column only), injuries', () => {
    const form = makeForm('inicial');
    const assets = Array.from({ length: 21 }, (_, i) => `MAini${i}`);
    const batches = buildEditBatches(INI, { form, inicialAssets: assets, finalAssets: [] });
    expect(batches.map((b) => b.pageIndex)).toEqual([1, 4, 5, 6, 7, 8, 9, 10, 11]);
    const cover = batches[0].operations;
    expect(cover).toContainEqual(expect.objectContaining({ find_text: 'NOMBRE', replace_text: 'MARÍA JOSÉ PEÑA GÓMEZ' }));
    expect(cover).toContainEqual(expect.objectContaining({ find_text: 'Mes DD, AAAA ', replace_text: 'Julio 08, 2026' }));
    expect(cover).toContainEqual({ type: 'update_title', title: 'REPORTE INICIAL María José Peña Gómez - Julio 08, 2026 - A5' });
    const fills = batches.flatMap((b) => b.operations).filter((o) => o.type === 'insert_fill');
    expect(fills).toHaveLength(21);
    for (const f of fills) if (f.type === 'insert_fill') expect(f.left).toBeLessThan(TEMPLATE.pageSize.width / 2);
    // photo 4 -> page 5, row 0, exact slot rect
    const p5 = findSlots(INI, 5).left[0];
    expect(batches[2].operations[0]).toMatchObject({ asset_id: 'MAini3', ...p5, page_id: INI.pages[4].page_id });
    const inj = batches[8].operations;
    expect(inj.map((o) => (o as { replace_text: string }).replace_text)).toEqual([
      'Grado 1 > 2-8 semanas',
      'Grado 2 > 6-12 semanas',
      'Ninguna',
      'Hernia discal L4-L5',
    ]);
  });

  it('Comparativo: Final n sits beside Inicial n; page 11 is untouched because it has no injury lines', () => {
    const form = makeForm('comparativo');
    const ini = Array.from({ length: 5 }, (_, i) => `MAi${i}`);
    const fin = Array.from({ length: 5 }, (_, i) => `MAf${i}`);
    const batches = buildEditBatches(COMP, { form, inicialAssets: ini, finalAssets: fin });
    expect(batches.map((b) => b.pageIndex)).toEqual([1, 4, 5]);
    expect(batches[0].operations).toContainEqual(
      expect.objectContaining({ find_text: 'Mes DD, AAAA - Mes DD, AAAA ', replace_text: 'Julio 08, 2026 - Octubre 02, 2026' }),
    );
    const allOps = batches.flatMap((b) => b.operations);
    expect(JSON.stringify(allOps)).not.toContain('XXXX');
    for (let n = 1; n <= 5; n++) {
      const a = allOps.find((o) => o.type === 'insert_fill' && o.asset_id === `MAi${n - 1}`) as { top: number; left: number };
      const b = allOps.find((o) => o.type === 'insert_fill' && o.asset_id === `MAf${n - 1}`) as { top: number; left: number };
      expect(Math.abs(a.top - b.top)).toBeLessThan(10); // same row
      expect(a.left).toBeLessThan(b.left); // inicial left, final right
    }
    expect(batches.some((b) => b.pageIndex === 11)).toBe(false);
  });

  it('Comparativo title uses the start date', () => {
    const batches = buildEditBatches(COMP, { form: makeForm('comparativo'), inicialAssets: ['MA1'], finalAssets: ['MA2'] });
    expect(batches[0].operations).toContainEqual({ type: 'update_title', title: 'REPORTE COMPARATIVO María José Peña Gómez - Julio 08, 2026 - A5' });
  });
});

describe('runReport against the mock server', () => {
  it('Inicial end-to-end: copies the template, never edits it, commits', async () => {
    const mock = new MockCanva();
    const res = await runReport(mock, { form: makeForm('inicial'), inicialPngs: pngs(21), finalPngs: [] });
    const names = mock.calls.map((c) => c.name);
    expect(names.filter((n) => n === 'create-upload-url')).toHaveLength(21);
    expect(names.slice(21)).toEqual([
      'copy-design',
      'start-editing-transaction',
      ...Array(9).fill('perform-editing-operations'),
      'commit-editing-transaction',
    ]);
    expect(mock.calls.find((c) => c.name === 'copy-design')!.args.design_id).toBe(CANVA.templates.inicial);
    for (const c of mock.calls) {
      if (c.name === 'start-editing-transaction') expect(CANVA.protectedDesignIds).not.toContain(c.args.design_id);
    }
    expect(mock.committed).toEqual([res.designId]);
    expect(mock.applied.get(res.designId)!.title).toBe(res.title);
    expect(res.editUrl).toMatch(/^https:\/\/www\.canva\.com\//);
    // every perform call echoes the pages array
    for (const c of mock.calls.filter((c) => c.name === 'perform-editing-operations')) expect(Array.isArray(c.args.pages)).toBe(true);
  });

  it('Comparativo with 21+21 photos uploads 42 and inserts 42', async () => {
    const mock = new MockCanva();
    const res = await runReport(mock, { form: makeForm('comparativo'), inicialPngs: pngs(21, 'i'), finalPngs: pngs(21, 'f') });
    const inserted = mock.applied.get(res.designId)!.operations.filter((o) => (o.op as { type: string }).type === 'insert_fill');
    expect(inserted).toHaveLength(42);
    expect(mock.uploads.size).toBe(42);
  });

  it('cancels the transaction when an edit fails', async () => {
    const mock = new MockCanva({ failTool: 'perform-editing-operations', failOnCall: 3 });
    await expect(runReport(mock, { form: makeForm('inicial'), inicialPngs: pngs(4), finalPngs: [] })).rejects.toThrow(/perform-editing-operations/);
    expect(mock.cancelled).toHaveLength(1);
    expect(mock.committed).toHaveLength(0);
  });

  it('retries a failed upload with a fresh URL', async () => {
    const mock = new MockCanva({ failTool: 'create-upload-url', failOnCall: 2 });
    await runReport(mock, { form: makeForm('inicial'), inicialPngs: pngs(3), finalPngs: [] });
    expect(mock.uploads.size).toBe(3);
  });

  it('upload failure happens before any copy is made', async () => {
    const mock = new MockCanva({ failTool: 'create-upload-url', failOnCall: 1 });
    // fail every attempt by making the mock fail calls 1..3 -> emulate with failOnCall=1 plus maxRetries
    let calls = 0;
    const always = { ...mock, callTool: async (n: string, a: Record<string, unknown>) => (calls++, n === 'create-upload-url' ? { isError: true, content: [{ type: 'text', text: 'down' }] } : mock.callTool(n, a)), upload: mock.upload.bind(mock) };
    await expect(runReport(always, { form: makeForm('inicial'), inicialPngs: pngs(1), finalPngs: [] })).rejects.toThrow();
    expect(mock.copies.size).toBe(0);
    expect(calls).toBeGreaterThan(0);
  }, 20_000);

  it('refuses protected ids', () => {
    for (const id of CANVA.protectedDesignIds) expect(() => assertEditable(id)).toThrow();
    expect(() => assertEditable('DAHxxxxxxxx')).not.toThrow();
  });
});
