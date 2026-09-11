import { useAppStore } from '../store/useAppStore';
import { en } from './en';
import { es } from './es';
import { DEFAULT_LOCALE, isLocale } from './types';
import type { Dictionary, Locale } from './types';

export type { Dictionary, Locale };
export { DEFAULT_LOCALE, isLocale };

const DICTIONARIES: Record<Locale, Dictionary> = { en, es };

/** Los idiomas que ofrece el selector, en el orden en que se muestran. */
export const LOCALES: readonly { id: Locale; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'es', label: 'Español', short: 'ES' },
];

/**
 * El diccionario actual, sin pasar por React.
 *
 * Lo usan las capas que no son componentes (la conexión, los avisos) y que
 * traducen en el momento de mostrar el mensaje, no antes.
 */
export function t(): Dictionary {
  return DICTIONARIES[useAppStore.getState().locale];
}

/**
 * El diccionario dentro de un componente.
 *
 * Va por el store, así cambiar de idioma vuelve a dibujar toda la pantalla sin
 * que ningún componente tenga que enterarse de nada.
 */
export function useT(): Dictionary {
  return DICTIONARIES[useAppStore((state) => state.locale)];
}

/** El idioma actual, para elegir a mano dentro de un `LocalizedName` del servidor. */
export function useLocale(): Locale {
  return useAppStore((state) => state.locale);
}
