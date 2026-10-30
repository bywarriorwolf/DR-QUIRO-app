import { describe, expect, it } from 'vitest';
import { fittedPersonHeight, pairedPersonHeight, placePerson, toPixelRect } from '../src/main/photos/layoutMath';

const C = { width: 825, height: 1000 };

describe('layout maths', () => {
  it('a tall person gets 80% of the slot height, feet at 90%, centred', () => {
    const b = { width: 200, height: 600 };
    const h = fittedPersonHeight(b, C);
    expect(h).toBeCloseTo(800);
    const r = placePerson(b, C, h);
    expect(r.top).toBeCloseTo(100); // 10% free on top
    expect(r.top + r.height).toBeCloseTo(900); // 10% free below
    expect(r.left + r.width / 2).toBeCloseTo(C.width / 2);
  });
  it('a wide subject is limited to 90% of the slot width', () => {
    const b = { width: 1000, height: 500 };
    const h = fittedPersonHeight(b, C);
    const r = placePerson(b, C, h);
    expect(r.width).toBeCloseTo(0.9 * C.width);
    expect(r.top + r.height).toBeCloseTo(900);
  });
  it('pairs get the same height: the smaller fit, so the "after" is never bigger', () => {
    const before = { width: 200, height: 600 };
    const after = { width: 700, height: 600 }; // wide pose -> width limited
    const h = pairedPersonHeight(before, after, C);
    expect(h).toBe(Math.min(fittedPersonHeight(before, C), fittedPersonHeight(after, C)));
    const a = placePerson(before, C, h);
    const b = placePerson(after, C, h);
    expect(a.height).toBe(b.height);
    expect(a.top + a.height).toBe(b.top + b.height);
    expect(b.width).toBeLessThanOrEqual(0.9 * C.width + 1e-9);
  });
  it('pixel rects round consistently and never collapse', () => {
    expect(toPixelRect({ left: 10.4, top: 0.6, width: 0.2, height: 99.8 })).toEqual({ left: 10, top: 1, width: 1, height: 99 });
  });
  it('rejects empty cut-outs', () => {
    expect(() => fittedPersonHeight({ width: 0, height: 10 }, C)).toThrow();
  });
});
