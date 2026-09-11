import { FLASH_VISIBLE_MS, SCORING } from '@flagazo/shared';
import type { Country, GameModeId } from '@flagazo/shared';
import { shuffle } from '../shuffle';
import type { GameMode } from './types';

/** Cuánto puede llegar a acortarse la mecha de la bomba, sobre el tiempo base. */
const BOMB_SHORTEST = 0.3;
/** Nunca menos de esto: con menos no se llega ni a leer la bandera. */
const BOMB_FLOOR_MS = 3_000;

/**
 * Banderas que se confunden entre sí, agrupadas y **de a pares consecutivos**.
 *
 * La gracia del modo no es que salgan banderas difíciles sueltas, sino ver
 * Rumania justo después de Chad: la confusión aparece cuando las tenés fresquitas
 * una al lado de la otra.
 */
function pickSimilarPairs(pool: readonly Country[], howMany: number): Country[] {
  const byId = new Map(pool.map((country) => [country.id, country]));
  const conParecidas = pool.filter((country) => country.similarTo?.length);

  const picked: Country[] = [];
  const yaUsadas = new Set<string>();

  for (const country of shuffle(conParecidas)) {
    if (picked.length >= howMany) break;
    if (yaUsadas.has(country.id)) continue;

    // La bandera y una de sus parecidas, seguidas.
    const pareja = shuffle(country.similarTo ?? [])
      .map((id) => byId.get(id))
      .find((similar) => similar && !yaUsadas.has(similar.id));

    picked.push(country);
    yaUsadas.add(country.id);
    if (pareja && picked.length < howMany) {
      picked.push(pareja);
      yaUsadas.add(pareja.id);
    }
  }

  // Si se pidieron más de las que hay pares, se vuelve a empezar la vuelta.
  while (picked.length < howMany && conParecidas.length > 0) {
    picked.push(...shuffle(conParecidas).slice(0, howMany - picked.length));
  }
  return picked.slice(0, howMany);
}

const MODES: Record<GameModeId, GameMode> = {
  normal: { id: 'normal' },

  // Los tres que se aclaran premian arriesgar temprano: cuanto antes la
  // reconocés, más bonus de velocidad te llevás.
  pixelated: { id: 'pixelated', presentation: { effect: 'pixelated', fades: true } },
  cropped: { id: 'cropped', presentation: { effect: 'cropped', fades: true } },

  // Este no se aclara nunca: mostrar el color sería regalar la respuesta.
  grayscale: { id: 'grayscale', presentation: { effect: 'grayscale', fades: false } },

  /*
   * Un fogonazo y listo: la bandera se ve medio segundo y se tapa.
   *
   * No se aclara con el tiempo (`fades: false`) porque no es un efecto que se
   * afloje, es binario. El resto del tiempo queda para escribir lo que hayas
   * llegado a reconocer.
   */
  flash: {
    id: 'flash',
    presentation: { effect: 'flash', fades: false, visibleMs: FLASH_VISIBLE_MS },
  },

  similar: { id: 'similar', pickFlags: pickSimilarPairs },

  bomb: {
    id: 'bomb',
    /** La mecha se acorta bandera a bandera dentro de la ronda. */
    flagDurationMs: ({ indexInRound, flagsPerRound, baseDurationMs }) => {
      // Con una sola bandera no hay mecha que acortar.
      const avance = flagsPerRound > 1 ? indexInRound / (flagsPerRound - 1) : 0;
      const factor = 1 - (1 - BOMB_SHORTEST) * avance;
      return Math.max(BOMB_FLOOR_MS, Math.round(baseDurationMs * factor));
    },
    /** Si explota sin tu respuesta, duele: quedarse callado deja de ser gratis. */
    missPenalty: SCORING.bombMissPenalty,
  },
};

export function getMode(id: GameModeId): GameMode {
  return MODES[id] ?? MODES.normal;
}
