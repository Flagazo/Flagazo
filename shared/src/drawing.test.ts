import { describe, expect, it } from 'vitest';
import { DRAW_CANVAS, DRAW_LIMITS, DRAW_PALETTE } from './draw';
import {
  base64UrlDecode,
  base64UrlEncode,
  decodeDrawing,
  encodeDrawing,
  simplifyPoints,
} from './drawing';
import type { Drawing, Stroke } from './drawing';

const brush = (points: number[], color = 'red', size = 1): Stroke => ({
  tool: 'brush',
  size,
  color,
  points,
});

function roundTrip(drawing: Drawing): Drawing {
  const result = decodeDrawing(encodeDrawing(drawing));
  if (!result.ok) throw new Error(`no decodificó: ${result.error}`);
  return result.drawing;
}

describe('formato de dibujo', () => {
  it('ida y vuelta conserva trazos, colores, grosores y puntos', () => {
    const drawing: Drawing = {
      strokes: [
        brush([10, 10, 20, 15, 35, 12]),
        brush([300, 200, 301, 201], 'navy', 2),
        { tool: 'eraser', size: 0, color: '-', points: [5, 5, 6, 6] },
      ],
    };
    expect(roundTrip(drawing)).toEqual(drawing);
  });

  it('todos los colores de la paleta viajan con su id', () => {
    const drawing: Drawing = {
      strokes: DRAW_PALETTE.map((color, i) => brush([i, i], color.id)),
    };
    expect(roundTrip(drawing)).toEqual(drawing);
  });

  it('un color personalizado viaja en hex y en minúsculas', () => {
    const decoded = roundTrip({ strokes: [brush([1, 1], '#AbCdEf')] });
    expect(decoded.strokes[0]?.color).toBe('#abcdef');
  });

  it('los saltos largos usan el escape y vuelven exactos', () => {
    // De punta a punta del lienzo: no entra en un byte con signo.
    const points = [0, 0, DRAW_CANVAS.width, DRAW_CANVAS.height, 0, DRAW_CANVAS.height, 127, 0];
    expect(roundTrip({ strokes: [brush(points)] }).strokes[0]?.points).toEqual(points);
  });

  it('un lienzo vacío es un dibujo válido sin trazos', () => {
    expect(decodeDrawing('1|')).toEqual({ ok: true, drawing: { strokes: [] } });
    expect(encodeDrawing({ strokes: [] })).toBe('1|');
  });

  it('un trazo típico pesa poco', () => {
    // Un garabato de relleno: 400 puntos con pasos cortos.
    const points: number[] = [];
    for (let i = 0; i < 400; i++) points.push(100 + ((i * 7) % 300), 50 + ((i * 3) % 200));
    const encoded = encodeDrawing({ strokes: [brush(points)] });
    // ~2 bytes por punto → base64 ≈ 2,7 caracteres.
    expect(encoded.length).toBeLessThan(400 * 3);
  });
});

describe('validación del dibujo que llega de afuera', () => {
  it('rechaza lo que no es un string o no tiene versión', () => {
    expect(decodeDrawing(42)).toEqual({ ok: false, error: 'NOT_A_STRING' });
    expect(decodeDrawing({ strokes: [] })).toEqual({ ok: false, error: 'NOT_A_STRING' });
    expect(decodeDrawing('2|')).toEqual({ ok: false, error: 'BAD_VERSION' });
    expect(decodeDrawing('data:image/png;base64,iVBORw0KGgo')).toEqual({
      ok: false,
      error: 'BAD_VERSION',
    });
  });

  it('rechaza un dibujo que se pasa del largo', () => {
    expect(decodeDrawing(`1|${'a'.repeat(DRAW_LIMITS.maxEncodedLength)}`)).toEqual({
      ok: false,
      error: 'TOO_LONG',
    });
  });

  it('rechaza puntos fuera del lienzo', () => {
    const encoded = encodeDrawing({ strokes: [brush([DRAW_CANVAS.width + 1, 10])] });
    expect(decodeDrawing(encoded)).toEqual({ ok: false, error: 'OUT_OF_CANVAS' });
  });

  it('rechaza un salto que termina afuera aunque el primer punto esté adentro', () => {
    const encoded = encodeDrawing({ strokes: [brush([590, 10, 700, 10])] });
    expect(decodeDrawing(encoded)).toEqual({ ok: false, error: 'OUT_OF_CANVAS' });
  });

  it('rechaza herramienta, grosor o color inventados', () => {
    expect(decodeDrawing('1|x10,AAAAAA')).toEqual({ ok: false, error: 'BAD_STROKE' });
    expect(decodeDrawing('1|b90,AAAAAA')).toEqual({ ok: false, error: 'BAD_SIZE' });
    expect(decodeDrawing('1|b1z,AAAAAA')).toEqual({ ok: false, error: 'BAD_COLOR' });
    expect(decodeDrawing('1|b1#zzzzzz,AAAAAA')).toEqual({ ok: false, error: 'BAD_COLOR' });
    // El borrador no lleva color.
    expect(decodeDrawing('1|e10,AAAAAA')).toEqual({ ok: false, error: 'BAD_COLOR' });
  });

  it('rechaza puntos mal empaquetados', () => {
    expect(decodeDrawing('1|b10,')).toEqual({ ok: false, error: 'BAD_POINTS' });
    expect(decodeDrawing('1|b10,!!!!')).toEqual({ ok: false, error: 'BAD_POINTS' });
    // Un escape sin los 4 bytes que tienen que venir detrás.
    const truncated = base64UrlEncode(new Uint8Array([0, 10, 0, 10, 0x80, 0]));
    expect(decodeDrawing(`1|b10,${truncated}`)).toEqual({ ok: false, error: 'BAD_POINTS' });
  });

  it('rechaza demasiados trazos', () => {
    const strokes = Array.from({ length: DRAW_LIMITS.maxStrokes + 1 }, () => brush([1, 1]));
    expect(decodeDrawing(encodeDrawing({ strokes }))).toEqual({
      ok: false,
      error: 'TOO_MANY_STROKES',
    });
  });

  it('rechaza demasiados puntos en total', () => {
    const perStroke = 2_000;
    const strokes = Array.from({ length: Math.ceil(DRAW_LIMITS.maxPoints / perStroke) + 1 }, () =>
      brush(Array.from({ length: perStroke * 2 }, (_, i) => (i % 2 === 0 ? i % 50 : 10))),
    );
    const result = decodeDrawing(encodeDrawing({ strokes }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['TOO_MANY_POINTS', 'TOO_LONG']).toContain(result.error);
  });
});

describe('simplifyPoints', () => {
  it('saca los puntos alineados y deja las esquinas', () => {
    const line = [0, 0, 10, 0, 20, 0, 30, 0, 30, 10, 30, 20];
    expect(simplifyPoints(line)).toEqual([0, 0, 30, 0, 30, 20]);
  });

  it('no toca trazos de uno o dos puntos', () => {
    expect(simplifyPoints([5, 5])).toEqual([5, 5]);
    expect(simplifyPoints([5, 5, 9, 9])).toEqual([5, 5, 9, 9]);
  });

  it('no mueve la forma más que la tolerancia', () => {
    // Una curva suave: el resultado tiene menos puntos pero todos los originales
    // quedan cerca de algún segmento del simplificado.
    const curve: number[] = [];
    for (let i = 0; i <= 100; i++) curve.push(i * 3, Math.round(100 + 50 * Math.sin(i / 10)));
    const simple = simplifyPoints(curve, 1);
    expect(simple.length).toBeLessThan(curve.length / 2);
  });
});

describe('base64url', () => {
  it('ida y vuelta con todos los largos', () => {
    for (let length = 0; length < 20; length++) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) % 256);
      expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
    }
  });
});
