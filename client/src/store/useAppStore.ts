import { create } from 'zustand';
import type { RoomState } from '@flagazo/shared';
import { DEFAULT_LOCALE, isLocale } from '../i18n/types';
import type { Locale } from '../i18n/types';
import { storage } from '../lib/storage';

export type Screen = 'nickname' | 'menu' | 'browse' | 'lobby' | 'game';
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';
export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface AppState {
  screen: Screen;
  connection: {
    status: ConnectionStatus;
    pingMs: number | null;
    online: number;
  };
  session: {
    playerId: string | null;
    /** Nickname confirmado por el servidor (null si todavía no eligió). */
    nickname: string | null;
  };
  /** Snapshot de la party actual tal cual lo mandó el servidor. null = no estoy en ninguna. */
  room: RoomState | null;
  toasts: Toast[];
  /** Idioma de la interfaz. Es del aparato, no de la party: cada uno lee en el suyo. */
  locale: Locale;
  /**
   * Sello del set de banderas, que manda el servidor al conectar.
   *
   * null hasta que llega: quien arma URLs de banderas tiene que esperarlo, no
   * pedirlas sin versión, porque una URL sin versión puede resolverse contra una
   * caché vieja del navegador y traer las banderas de antes.
   */
  flagsVersion: string | null;

  goTo: (screen: Screen) => void;
  setConnection: (partial: Partial<AppState['connection']>) => void;
  setSession: (partial: Partial<AppState['session']>) => void;
  setRoom: (room: RoomState | null) => void;
  setFlagsVersion: (version: string) => void;
  pushToast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
  setLocale: (locale: Locale) => void;
}

let nextToastId = 1;

/**
 * El idioma con el que arranca la sesión.
 *
 * Primero lo que el jugador eligió alguna vez; si nunca eligió, inglés. A
 * propósito no se mira el idioma del navegador: el juego se comparte por link y
 * es más previsible que todos vean lo mismo hasta que alguien decida cambiarlo.
 */
function initialLocale(): Locale {
  const saved = storage.getLocale();
  const locale = isLocale(saved) ? saved : DEFAULT_LOCALE;
  document.documentElement.lang = locale;
  return locale;
}

/**
 * Estado global del cliente. Es solo un reflejo de lo que dice el servidor
 * más estado puramente visual: nunca decide nada del juego.
 */
export const useAppStore = create<AppState>((set, get) => ({
  screen: 'nickname',
  connection: { status: 'connecting', pingMs: null, online: 0 },
  session: { playerId: null, nickname: null },
  room: null,
  toasts: [],
  locale: initialLocale(),
  flagsVersion: null,

  goTo: (screen) => set({ screen }),
  setConnection: (partial) => set({ connection: { ...get().connection, ...partial } }),
  setSession: (partial) => set({ session: { ...get().session, ...partial } }),
  setRoom: (room) => set({ room }),
  setFlagsVersion: (flagsVersion) => set({ flagsVersion }),

  pushToast: (message, tone = 'info') => {
    const id = nextToastId++;
    set({ toasts: [...get().toasts, { id, message, tone }].slice(-3) });
    setTimeout(() => get().dismissToast(id), 3200);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setLocale: (locale) => {
    storage.setLocale(locale);
    document.documentElement.lang = locale;
    set({ locale });
  },
}));

/** Atajo usado en varias pantallas: ¿soy el host de la party actual? */
export function selectIsHost(state: AppState): boolean {
  return Boolean(state.room && state.session.playerId === state.room.hostId);
}
