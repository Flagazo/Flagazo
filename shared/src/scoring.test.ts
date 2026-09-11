import { describe, expect, it } from 'vitest';
import { PRECISION, SCORING, pointsForCorrect, speedBonus, streakMultiplier } from './scoring';

/** Acierto perfecto respondiendo al instante y sin racha previa. */
const instant = (streak = 1, precision: number = PRECISION.perfect) =>
  pointsForCorrect({ precision, elapsedMs: 0, totalMs: 10_000, streak });

describe('bonus por velocidad', () => {
  it('es máximo al instante y cero cuando se acaba el tiempo', () => {
    expect(speedBonus(0, 10_000)).toBe(SCORING.maxSpeedBonus);
    expect(speedBonus(10_000, 10_000)).toBe(0);
    expect(speedBonus(5_000, 10_000)).toBe(SCORING.maxSpeedBonus / 2);
  });

  it('no se pasa de rango con valores raros', () => {
    expect(speedBonus(-100, 10_000)).toBe(SCORING.maxSpeedBonus);
    expect(speedBonus(99_999, 10_000)).toBe(0);
    expect(speedBonus(1_000, 0)).toBe(0);
  });
});

describe('multiplicador por racha', () => {
  it('arranca en 1 y sube por escalones', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(2)).toBe(1);
    expect(streakMultiplier(3)).toBe(1.5);
    expect(streakMultiplier(4)).toBe(1.5);
    expect(streakMultiplier(5)).toBe(2);
    expect(streakMultiplier(9)).toBe(2);
    expect(streakMultiplier(10)).toBe(3);
    expect(streakMultiplier(50)).toBe(3);
  });
});

describe('puntos de un acierto', () => {
  it('sin racha: 100 de base más lo que sobró de tiempo', () => {
    expect(instant()).toBe(150); // 100 + 50 de velocidad
    expect(pointsForCorrect({ precision: 1, elapsedMs: 10_000, totalMs: 10_000, streak: 1 })).toBe(100);
    expect(pointsForCorrect({ precision: 1, elapsedMs: 5_000, totalMs: 10_000, streak: 1 })).toBe(125);
  });

  it('la racha multiplica el total, no solo la base', () => {
    expect(instant(3)).toBe(225); // 150 × 1.5
    expect(instant(5)).toBe(300); // 150 × 2
    expect(instant(10)).toBe(450); // 150 × 3
  });

  it('responder tarde con racha alta rinde más que rápido sin racha', () => {
    const tardeConRacha = pointsForCorrect({
      precision: 1,
      elapsedMs: 9_000,
      totalMs: 10_000,
      streak: 5,
    });
    expect(tardeConRacha).toBeGreaterThan(instant(1));
  });

  it('la precisión baja el puntaje pero no el bonus de velocidad', () => {
    // Preparado para el fuzzy de la Fase 4: hoy la precisión siempre es 1.
    expect(instant(1, PRECISION.oneTypo)).toBe(130); // 80 + 50
    expect(instant(1, PRECISION.moreTypos)).toBe(120); // 70 + 50
  });

  it('siempre devuelve enteros', () => {
    for (const streak of [1, 3, 5, 10]) {
      for (const ms of [0, 1234, 7777, 10_000]) {
        const points = pointsForCorrect({ precision: 1, elapsedMs: ms, totalMs: 10_000, streak });
        expect(Number.isInteger(points)).toBe(true);
      }
    }
  });
});
