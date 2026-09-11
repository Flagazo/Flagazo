import type { Country, Difficulty } from '@flagazo/shared';
import { normalizeName } from '../answers/normalize';
import dataset from './countries.json';

/**
 * Carga el dataset generado y arma el índice de búsqueda una sola vez al arrancar.
 *
 * El índice va de `nombre normalizado` a los países que responden a ese nombre.
 * Son ~8900 claves: construirlo tarda milisegundos y evita recorrer 195 países
 * por cada respuesta de cada jugador.
 */
interface Dataset {
  countries: Country[];
  /** Términos que no alcanzan para identificar un país ("congo", "corea"). */
  ambiguous: Record<string, string[]>;
}

const data = dataset as Dataset;

export const COUNTRIES: readonly Country[] = data.countries;

const byId = new Map(COUNTRIES.map((country) => [country.id, country]));

/** nombre normalizado → países que lo usan. */
const nameIndex = new Map<string, string[]>();
for (const country of COUNTRIES) {
  for (const name of [...Object.values(country.names).flat(), ...country.aliases]) {
    const key = normalizeName(name);
    if (!key) continue;
    const owners = nameIndex.get(key);
    if (owners) {
      if (!owners.includes(country.id)) owners.push(country.id);
    } else {
      nameIndex.set(key, [country.id]);
    }
  }
}

/**
 * Los términos ambiguos se agregan al índice aunque ningún país los use tal cual:
 * "Corea" no es el nombre de nadie, pero escribirlo tiene que pedir precisión
 * en vez de contar como error.
 */
const ambiguousIndex = new Map<string, string[]>(
  Object.entries(data.ambiguous).map(([term, ids]) => [term, ids]),
);

/**
 * Los mismos nombres, agrupados por largo.
 *
 * El fuzzy compara contra todos los nombres del índice, pero un nombre que
 * difiere en más letras de las que se perdonan no puede coincidir nunca. Tener
 * los largos separados permite saltear esos grupos enteros sin calcular nada:
 * de ~8900 candidatos quedan unos pocos cientos.
 */
const keysByLength = new Map<number, { key: string; owners: string[] }[]>();
for (const [key, owners] of nameIndex) {
  const bucket = keysByLength.get(key.length);
  if (bucket) bucket.push({ key, owners });
  else keysByLength.set(key.length, [{ key, owners }]);
}

export function searchKeysOfLength(length: number): readonly { key: string; owners: string[] }[] {
  return keysByLength.get(length) ?? [];
}

export function getCountry(id: string): Country | undefined {
  return byId.get(id);
}

/** Países que responden a un nombre ya normalizado. */
export function countriesNamed(normalized: string): readonly string[] {
  return nameIndex.get(normalized) ?? [];
}

/** Si el término es ambiguo, a qué países podría referirse. */
export function ambiguousMeanings(normalized: string): readonly string[] {
  return ambiguousIndex.get(normalized) ?? [];
}

/**
 * Banderas jugables según la dificultad elegida.
 * 'all' devuelve las 195; el resto filtra por nivel.
 */
export function poolFor(difficulty: Difficulty): readonly Country[] {
  if (difficulty === 'all') return COUNTRIES;
  return COUNTRIES.filter((country) => country.difficulty === difficulty);
}

export const DATASET_STATS = {
  countries: COUNTRIES.length,
  searchKeys: nameIndex.size,
  ambiguousTerms: ambiguousIndex.size,
};
