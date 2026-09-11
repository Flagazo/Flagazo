import type { en } from './en';

export type Locale = 'en' | 'es';

/**
 * Ensancha los tipos literales que deja `as const` en el diccionario inglés.
 *
 * Sin esto, `Dictionary` exigiría que el español dijera literalmente "Play" en
 * vez de "Jugar". Lo que sí se conserva es la forma: qué claves existen y qué
 * argumentos toma cada función, que es justo lo que tiene que coincidir.
 */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : { -readonly [K in keyof T]: Widen<T[K]> };

/** La forma de un diccionario, sacada del inglés porque es el idioma de referencia. */
export type Dictionary = Widen<typeof en>;

/** Inglés por defecto: es el idioma que más gente entiende sin elegir nada. */
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: string | null): value is Locale {
  return value === 'en' || value === 'es';
}
