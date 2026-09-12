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

  /**
   * El dibujo en curso de Draw Battle, por sala y ronda.
   *
   * En sessionStorage, como la sesión: sobrevive a un F5 en medio del dibujo y
   * es de esta pestaña. Guardar uno nuevo borra los de rondas anteriores, que ya
   * no sirven para nada.
   */
  getDraft: (code: string, round: number) => read(() => sessionStorage, draftKey(code, round)),
  setDraft: (code: string, round: number, drawing: string) => {
    const key = draftKey(code, round);
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const other = sessionStorage.key(i);
        if (other?.startsWith(DRAFT_PREFIX) && other !== key) sessionStorage.removeItem(other);
      }
    } catch {
      // Sin almacenamiento: no se recupera el dibujo tras un F5, pero se juega igual.
    }
    write(() => sessionStorage, key, drawing);
  },
};

const DRAFT_PREFIX = 'flagazo:draw:';
const draftKey = (code: string, round: number) => `${DRAFT_PREFIX}${code}:${round}`;
