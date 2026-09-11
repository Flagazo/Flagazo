import { describe, expect, it } from 'vitest';
import { editDistance, toleranceFor } from './distance';

/** Distancia sin tope, para poder afirmar el valor exacto. */
const d = (a: string, b: string) => editDistance(a, b, 99);

describe('editDistance', () => {
  it('es 0 entre textos iguales', () => {
    expect(d('argentina', 'argentina')).toBe(0);
    expect(d('', '')).toBe(0);
  });

  it('cuenta una edición por letra agregada, borrada o cambiada', () => {
    expect(d('argentina', 'argentinaa')).toBe(1); // sobra una
    expect(d('argentina', 'argentin')).toBe(1); // falta una
    expect(d('argentina', 'argentena')).toBe(1); // cambiada
  });

  it('cuenta el intercambio de dos letras contiguas como UNA edición', () => {
    // Es lo que distingue a Damerau: escribiendo rápido se invierten letras.
    expect(d('argentina', 'argnetina')).toBe(1);
    expect(d('brasil', 'brasli')).toBe(1);
    expect(d('chile', 'chile')).toBe(0);
  });

  it('suma cuando hay varios errores', () => {
    expect(d('argentina', 'argntna')).toBe(2);
    expect(d('argentina', 'brasil')).toBeGreaterThan(3);
  });

  it('maneja textos vacíos', () => {
    expect(d('', 'chile')).toBe(5);
    expect(d('chile', '')).toBe(5);
  });

  it('abandona apenas supera el tope y devuelve tope + 1', () => {
    expect(editDistance('argentina', 'brasil', 2)).toBe(3);
    expect(editDistance('argentina', 'argnetina', 1)).toBe(1);
    // Diferencia de largo mayor al tope: se descarta sin calcular.
    expect(editDistance('a', 'abcdefghij', 2)).toBe(3);
  });

  it('es simétrica', () => {
    expect(d('australia', 'austria')).toBe(d('austria', 'australia'));
    expect(d('peru', 'perv')).toBe(d('perv', 'peru'));
  });
});

describe('toleranceFor', () => {
  it('no perdona nada en nombres cortos', () => {
    // Con tolerancia 1, "Chad" aceptaría "Chat" y "Irán" aceptaría "Irak".
    expect(toleranceFor(4)).toBe(0); // Perú, Irán, Cuba, Chad
    expect(toleranceFor(1)).toBe(0);
  });

  it('crece con el largo del nombre', () => {
    expect(toleranceFor(5)).toBe(1); // Chile
    expect(toleranceFor(7)).toBe(1);
    expect(toleranceFor(8)).toBe(2);
    expect(toleranceFor(11)).toBe(2);
    expect(toleranceFor(12)).toBe(3);
    expect(toleranceFor(30)).toBe(3);
  });
});
