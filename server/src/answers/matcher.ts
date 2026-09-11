import { PRECISION } from '@flagazo/shared';
import type { LocalizedName } from '@flagazo/shared';
import { ambiguousMeanings, countriesNamed, getCountry, searchKeysOfLength } from '../data/countries';
import { MAX_TOLERANCE, editDistance, toleranceFor } from './distance';
import { normalizeName } from './normalize';

/**
 * Veredicto de una respuesta.
 *
 * - `correct`: escribió un nombre del país, tal cual.
 * - `close`: se equivocó al tipear pero se entiende que quiso decir ese país.
 *   Cuenta como acierto, con menos puntos.
 * - `ambiguous`: lo que escribió podría ser el país correcto u otro. No es un
 *   error: no gasta el intento y se le pide que sea más específico.
 * - `wrong`: escribió otra cosa.
 */
export type AnswerVerdict = 'correct' | 'close' | 'ambiguous' | 'wrong';

export interface AnswerResult {
  verdict: AnswerVerdict;
  /** Texto ya normalizado, para loguear y depurar sin volver a calcularlo. */
  normalized: string;
  /** Cuán exacta fue: 1 sin errores, menos si hubo que perdonar tipeos. */
  precision: number;
  /** Errores de tipeo que se perdonaron. 0 en una respuesta exacta. */
  distance: number;
  /** Solo en 'ambiguous': entre qué países habría que elegir. */
  options?: LocalizedName[];
}

/** Un error se perdona al 80 %, dos o más al 70 %. */
function precisionFor(distance: number): number {
  if (distance === 0) return PRECISION.perfect;
  if (distance === 1) return PRECISION.oneTypo;
  return PRECISION.moreTypos;
}

/**
 * Decide si una respuesta acierta la bandera.
 *
 * Sigue el orden de la tabla de decisión de la arquitectura: primero las
 * coincidencias exactas (que son la enorme mayoría y no cuestan nada), y solo
 * si no hubo ninguna se paga el fuzzy.
 */
export function matchAnswer(raw: string, targetId: string): AnswerResult {
  const normalized = normalizeName(raw);
  const miss = (verdict: AnswerVerdict = 'wrong'): AnswerResult => ({
    verdict,
    normalized,
    precision: 0,
    distance: -1,
  });

  if (!normalized) return miss();

  // ── 1 a 3: coincidencia exacta ────────────────────────────
  const exact = new Set<string>(countriesNamed(normalized));
  for (const id of ambiguousMeanings(normalized)) exact.add(id);

  if (exact.size === 1) {
    const only = [...exact][0]!;
    if (only === targetId) {
      return { verdict: 'correct', normalized, precision: PRECISION.perfect, distance: 0 };
    }
    // Es el nombre exacto de otro país: escribió mal, no se equivocó tipeando.
    return miss();
  }

  if (exact.size > 1) {
    if (!exact.has(targetId)) return miss();
    return { ...miss('ambiguous'), options: namesOf([...exact]) };
  }

  // ── 4: fuzzy ──────────────────────────────────────────────
  return fuzzyMatch(normalized, targetId);
}

/**
 * Busca el país cuyo nombre más se parece a lo que escribió.
 *
 * Solo cuenta como acierto si el más parecido es el correcto **y** le saca al
 * menos una edición de ventaja al mejor de cualquier otro país. Si empatan
 * ("Austrlia" está a 1 de Australia y a 1 de Austria) no se adivina: se pide
 * que escriba mejor.
 */
function fuzzyMatch(normalized: string, targetId: string): AnswerResult {
  /** Mejor (menor) distancia encontrada para cada país. */
  const best = new Map<string, number>();

  // Solo los largos que podrían entrar en la tolerancia; el resto ni se mira.
  const from = Math.max(1, normalized.length - MAX_TOLERANCE);
  const to = normalized.length + MAX_TOLERANCE;

  for (let length = from; length <= to; length++) {
    const tolerance = toleranceFor(length);
    if (Math.abs(length - normalized.length) > tolerance) continue;

    for (const { key, owners } of searchKeysOfLength(length)) {
      const distance = editDistance(normalized, key, tolerance);
      if (distance > tolerance) continue;

      for (const id of owners) {
        const previous = best.get(id);
        if (previous === undefined || distance < previous) best.set(id, distance);
      }
    }
  }

  const forTarget = best.get(targetId);
  const miss: AnswerResult = { verdict: 'wrong', normalized, precision: 0, distance: -1 };
  if (forTarget === undefined) return miss;

  // El mejor de los demás países, para ver si hay competencia.
  let bestOther = Infinity;
  const tied: string[] = [];
  for (const [id, distance] of best) {
    if (id === targetId) continue;
    if (distance < bestOther) {
      bestOther = distance;
      tied.length = 0;
    }
    if (distance === bestOther) tied.push(id);
  }

  if (forTarget < bestOther) {
    return {
      verdict: 'close',
      normalized,
      precision: precisionFor(forTarget),
      distance: forTarget,
    };
  }

  // Empate: podría ser cualquiera de los dos, así que no se gasta el intento.
  if (forTarget === bestOther) {
    return {
      verdict: 'ambiguous',
      normalized,
      precision: 0,
      distance: forTarget,
      options: namesOf([targetId, ...tied]),
    };
  }

  // Otro país se parece más: lo que escribió no era esto.
  return miss;
}

/**
 * Los nombres para mostrar, porque al jugador los códigos ISO no le dicen nada.
 *
 * Van en los dos idiomas: el servidor no sabe en cuál está mirando cada jugador,
 * así que manda ambos y el cliente elige. El orden es el mismo para todos
 * (alfabético en español) para que la lista no dependa de quién la lea.
 */
function namesOf(ids: string[]): LocalizedName[] {
  return ids
    .map((id) => getCountry(id)?.displayName ?? { es: id, en: id })
    .sort((a, b) => a.es.localeCompare(b.es));
}
