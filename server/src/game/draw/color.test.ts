import { DRAW_PALETTE } from '@flagazo/shared';
import { describe, expect, it } from 'vitest';
import {
  SIMILARITY,
  PAINT_CLASSES,
  classOfStrokeColor,
  classifyRgb,
  hexToRgb,
  paletteFingerprint,
} from './color';
import { REFERENCES_FINGERPRINT } from './references';

const classOf = (id: string) => DRAW_PALETTE.findIndex((color) => color.id === id);

describe('clases de color', () => {
  it('cada color de la paleta se clasifica como sí mismo', () => {
    DRAW_PALETTE.forEach((color, index) => {
      expect(classifyRgb(hexToRgb(color.hex))).toBe(index);
    });
  });

  it('los azules oscuros de las banderas caen en azul, no en violeta', () => {
    // Brasil y Sudáfrica en Wikimedia. Sin la penalización a priori, violeta.
    expect([classOf('blue'), classOf('navy')]).toContain(classifyRgb(hexToRgb('#3E4095')));
    expect([classOf('blue'), classOf('navy')]).toContain(classifyRgb(hexToRgb('#002395')));
  });

  it('un color personalizado va a la clase más parecida', () => {
    expect(classOfStrokeColor('#e00000')).toBe(classOf('red'));
    expect(classOfStrokeColor('#74acdf')).toBe(classOf('lightBlue'));
    expect(classOfStrokeColor('#fefefe')).toBe(classOf('white'));
  });

  it('la tabla de parecidos es simétrica y vale 1 en la diagonal', () => {
    for (let a = 0; a < PAINT_CLASSES; a++) {
      expect(SIMILARITY[a * PAINT_CLASSES + a]).toBe(1);
      for (let b = 0; b < PAINT_CLASSES; b++) {
        expect(SIMILARITY[a * PAINT_CLASSES + b]).toBe(SIMILARITY[b * PAINT_CLASSES + a]);
      }
    }
  });

  /*
   * Si alguien cambia un color o una penalización y no regenera las referencias,
   * las banderas quedan leídas con la paleta vieja y comparadas con la nueva.
   * Se arregla con `npm run build:flag-refs`.
   */
  it('las referencias se generaron con la paleta actual', () => {
    expect(REFERENCES_FINGERPRINT).toBe(paletteFingerprint());
  });
});
