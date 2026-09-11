/**
 * Sonidos del juego, **sintetizados**.
 *
 * Son los placeholders de la Fase 6: en vez de archivos de audio (que habría que
 * buscar, licenciar y bajar), cada sonido es una recetita de notas que el
 * navegador genera con Web Audio. Ventajas mientras el juego se está armando:
 * pesan cero, no hay licencias que revisar y suenan igual en todos lados.
 *
 * Para pasar a sonidos de verdad no hace falta tocar nada del juego: alcanza con
 * reemplazar `playRecipe` en SoundManager por un reproductor de archivos y dejar
 * estos nombres como están.
 */

export type SoundName =
  | 'tick' // cada segundo de la cuenta regresiva
  | 'go' // arranca la bandera
  | 'correct' // acertaste
  | 'close' // acertaste con un tipeo perdonado
  | 'wrong' // erraste
  | 'ambiguous' // hay que ser más específico
  | 'reveal' // se descubre el país
  | 'streak' // la racha subió de escalón
  | 'roundEnd' // cierre de ronda
  | 'gameEnd' // final de la partida
  | 'join'; // alguien entró a la party

export interface Note {
  /** Frecuencia en Hz. */
  freq: number;
  /** Desde cuándo suena, en ms desde el inicio del sonido. */
  at: number;
  /** Cuánto dura, en ms. */
  ms: number;
  type?: OscillatorType;
  /** Volumen relativo, de 0 a 1. */
  gain?: number;
}

/** Notas de referencia, para que las recetas se lean como música y no como números. */
const C5 = 523;
const E5 = 659;
const G5 = 784;
const C6 = 1046;
const E6 = 1318;

export const RECIPES: Record<SoundName, Note[]> = {
  // Seco y corto: marca el segundo sin molestar.
  tick: [{ freq: G5, at: 0, ms: 60, type: 'square', gain: 0.18 }],
  // Sube: "¡ya!"
  go: [
    { freq: C5, at: 0, ms: 70 },
    { freq: G5, at: 60, ms: 120, gain: 0.4 },
  ],
  // Tercera mayor ascendente: suena a premio.
  correct: [
    { freq: C6, at: 0, ms: 90 },
    { freq: E6, at: 70, ms: 160, gain: 0.32 },
  ],
  // Como el acierto pero más apagado: te la dieron, pero raspando.
  close: [
    { freq: G5, at: 0, ms: 90, gain: 0.26 },
    { freq: C6, at: 70, ms: 140, gain: 0.22 },
  ],
  // Dos notas que bajan, con onda áspera.
  wrong: [
    { freq: 300, at: 0, ms: 110, type: 'sawtooth', gain: 0.22 },
    { freq: 180, at: 90, ms: 180, type: 'sawtooth', gain: 0.2 },
  ],
  // Dos golpes iguales: el "¿mmm?" de que falta precisión.
  ambiguous: [
    { freq: 520, at: 0, ms: 80, type: 'triangle', gain: 0.24 },
    { freq: 520, at: 130, ms: 80, type: 'triangle', gain: 0.24 },
  ],
  // Campanita suave al descubrirse el país.
  reveal: [
    { freq: E5, at: 0, ms: 200, type: 'sine', gain: 0.22 },
    { freq: C6, at: 40, ms: 260, type: 'sine', gain: 0.16 },
  ],
  // Arpegio rápido hacia arriba: la racha subió.
  streak: [
    { freq: C5, at: 0, ms: 70 },
    { freq: E5, at: 55, ms: 70 },
    { freq: G5, at: 110, ms: 70 },
    { freq: C6, at: 165, ms: 180, gain: 0.35 },
  ],
  roundEnd: [
    { freq: C5, at: 0, ms: 120 },
    { freq: E5, at: 100, ms: 120 },
    { freq: G5, at: 200, ms: 260, gain: 0.3 },
  ],
  // Fanfarria corta.
  gameEnd: [
    { freq: C5, at: 0, ms: 140 },
    { freq: E5, at: 120, ms: 140 },
    { freq: G5, at: 240, ms: 140 },
    { freq: C6, at: 360, ms: 420, gain: 0.38 },
  ],
  join: [{ freq: E5, at: 0, ms: 90, type: 'sine', gain: 0.2 }],
};
