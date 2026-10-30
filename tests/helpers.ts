import type { ReportForm } from '../src/shared/report';

export function makeForm(type: ReportForm['type'], over: Partial<ReportForm> = {}): ReportForm {
  return {
    type,
    nombre: 'María José',
    apellido: 'Peña Gómez',
    fechaInicial: { year: 2026, month: 7, day: 8 },
    fechaFinal: type === 'comparativo' ? { year: 2026, month: 10, day: 2 } : null,
    injuries: {
      tension: 'Grado 1 > 2-8 semanas',
      tendon: 'Grado 2 > 6-12 semanas',
      ligamento: 'Ninguna',
      otras: 'Hernia discal L4-L5',
    },
    ...over,
  };
}

export const pngs = (n: number, tag = 'p') => Array.from({ length: n }, (_, i) => Buffer.from(`${tag}${i}`));
