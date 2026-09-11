/**
 * Acceso seguro al almacenamiento del navegador (puede fallar en modo privado).
 *
 * - nickname → localStorage: se recuerda entre visitas.
 * - token de sesión → sessionStorage: uno por pestaña. Sobrevive a F5,
 *   y permite abrir varias pestañas como jugadores distintos para probar.
 */
const KEYS = {
  nickname: 'flagazo:nickname',
  sessionToken: 'flagazo:session-token',
  hideCode: 'flagazo:hide-code',
  muted: 'flagazo:muted',
  locale: 'flagazo:locale',
} as const;

function read(getStorage: () => Storage, key: string): string | null {
  try {
    return getStorage().getItem(key);
  } catch {
    return null;
  }
}

function write(getStorage: () => Storage, key: string, value: string) {
  try {
    getStorage().setItem(key, value);
  } catch {
    // Sin almacenamiento disponible: el juego funciona igual, solo no recuerda datos.
  }
}

export const storage = {
  getNickname: () => read(() => localStorage, KEYS.nickname),
  setNickname: (nickname: string) => write(() => localStorage, KEYS.nickname, nickname),
  getSessionToken: () => read(() => sessionStorage, KEYS.sessionToken),
  setSessionToken: (token: string) => write(() => sessionStorage, KEYS.sessionToken, token),
  /** Preferencia de cada jugador: tapar el código para compartir pantalla sin filtrarlo. */
  getHideCode: () => read(() => localStorage, KEYS.hideCode) === '1',
  setHideCode: (hide: boolean) => write(() => localStorage, KEYS.hideCode, hide ? '1' : '0'),
  /** Silencio del juego. Se recuerda entre visitas. */
  getMuted: () => read(() => localStorage, KEYS.muted) === '1',
  setMuted: (muted: boolean) => write(() => localStorage, KEYS.muted, muted ? '1' : '0'),
  /** Idioma elegido. Devuelve el crudo: quién lo lee decide si es válido. */
  getLocale: () => read(() => localStorage, KEYS.locale),
  setLocale: (locale: string) => write(() => localStorage, KEYS.locale, locale),
};
