/**
 * The clinic's approved Spanish stays word for word. Labels that used to be
 * English are translated, and the photo toggle is a manual choice.
 */
import { describe, expect, it } from 'vitest';
import { createReportSchema } from '../src/shared/ipc';
import { S } from '../src/shared/strings';

const form = {
  type: 'inicial' as const,
  nombre: 'María',
  apellido: 'Gómez',
  fechaInicial: { year: 2026, month: 7, day: 8 },
  fechaFinal: null,
  injuries: { tension: 'No Aplica', tendon: 'No Aplica', ligamento: 'No Aplica', otras: 'No Aplica' },
};

describe('Spanish UI copy', () => {
  it('translates the labels that were still in English', () => {
    expect(S.dropHere).toBe('Arrastra aquí las fotos del paciente');
    expect(S.createFile).toBe('Crear archivo');
    expect(S.pickerOk).toBe('Aceptar');
    expect(S.menu).toBe('Menú');
    expect(S.pickPhotos).toBe('Seleccionar fotos');
    expect(S.pickPhotosFilter).toBe('Archivos PNG y JPG');
    const blob = JSON.stringify(S);
    expect(blob).not.toContain('Drop Patient Photos Here');
    expect(blob).not.toContain('Create File');
  });

  it('keeps approved Spanish copy unchanged', () => {
    expect(S.uploading).toBe('Subiendo Archivos');
    expect(S.creatingDocument).toBe('Creando Documento');
    expect(S.missingAntes).toBe('Te faltó subir las fotos de “ANTES”');
    expect(S.missingDespues).toBe('Te faltó subir las fotos de “DESPUÉS”');
    expect(S.wrongFormatBody).toBe('Solo se aceptan archivos PNG y JPG');
    expect(S.maxPhotos).toBe('Máximo 21 fotos');
    expect(S.useOriginal).toBe('Usar foto original');
    expect(S.useCutout).toBe('Usar recorte');
    expect(S.errors.canva).toBe('Canva rechazó la operación. Inténtalo de nuevo en unos minutos.');
  });

  it('sends original photos only when the user asked, and otherwise leaves the cutout default', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    expect(createReportSchema.parse({ form, inicial: [id], final: [] }).useOriginal).toBeUndefined();
    expect(createReportSchema.parse({ form, inicial: [id], final: [other], useOriginal: [other] }).useOriginal).toEqual([other]);
  });
});
