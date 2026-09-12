import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_SETTINGS,
  MAX_FLAGS_PER_ROUND,
  MIN_FLAGS_PER_ROUND,
  TOTAL_ROUNDS_OPTIONS,
} from './constants';
import {
  fitsInGame,
  isValidPartyCode,
  isValidSessionToken,
  isValidSettings,
  maxFlagsPerRoundFor,
  nicknameKey,
  normalizePartyCode,
  parseSettingsPatch,
  validateNickname,
} from './validation';

describe('validateNickname', () => {
  it('acepta nombres normales y limpia espacios', () => {
    expect(validateNickname('  Anya  ')).toEqual({ ok: true, value: 'Anya' });
    expect(validateNickname('Juan   Pablo')).toEqual({ ok: true, value: 'Juan Pablo' });
    expect(validateNickname('Ñandú_99')).toEqual({ ok: true, value: 'Ñandú_99' });
    expect(validateNickname('Björk.x')).toEqual({ ok: true, value: 'Björk.x' });
    expect(validateNickname('Алексей')).toEqual({ ok: true, value: 'Алексей' });
  });

  it('rechaza vacíos, cortos y largos', () => {
    expect(validateNickname('')).toEqual({ ok: false, error: 'EMPTY' });
    expect(validateNickname('    ')).toEqual({ ok: false, error: 'EMPTY' });
    expect(validateNickname('a')).toEqual({ ok: false, error: 'TOO_SHORT' });
    expect(validateNickname('a'.repeat(17))).toEqual({ ok: false, error: 'TOO_LONG' });
    expect(validateNickname('a'.repeat(5000))).toEqual({ ok: false, error: 'TOO_LONG' });
  });

  it('rechaza caracteres problemáticos', () => {
    expect(validateNickname('<script>')).toEqual({ ok: false, error: 'INVALID_CHARS' });
    expect(validateNickname('pepe😀')).toEqual({ ok: false, error: 'INVALID_CHARS' });
    expect(validateNickname('ab\u200Bcd')).toEqual({ ok: false, error: 'INVALID_CHARS' }); // espacio invisible
    expect(validateNickname('___')).toEqual({ ok: false, error: 'NEEDS_ALPHANUMERIC' });
  });

  it('rechaza tipos que no son string', () => {
    expect(validateNickname(undefined)).toEqual({ ok: false, error: 'EMPTY' });
    expect(validateNickname({ nickname: 'x' })).toEqual({ ok: false, error: 'EMPTY' });
  });
});

describe('nicknameKey', () => {
  it('iguala mayúsculas y tildes', () => {
    expect(nicknameKey('Juán')).toBe(nicknameKey('JUAN'));
    expect(nicknameKey('juan')).not.toBe(nicknameKey('juana'));
  });
});

describe('códigos de party', () => {
  it('normaliza y valida', () => {
    expect(normalizePartyCode(' x7k-92 ')).toBe('X7K92');
    expect(isValidPartyCode('X7K92')).toBe(true);
    expect(isValidPartyCode('X7K9')).toBe(false);
    expect(isValidPartyCode('O0I1L')).toBe(false); // caracteres ambiguos excluidos
  });
});

describe('isValidSessionToken', () => {
  it('solo acepta hex de 48 caracteres', () => {
    expect(isValidSessionToken('a'.repeat(48))).toBe(true);
    expect(isValidSessionToken('z'.repeat(48))).toBe(false);
    expect(isValidSessionToken(123)).toBe(false);
  });
});

describe('parseSettingsPatch', () => {
  it('acepta solo los valores de las listas cerradas', () => {
    expect(parseSettingsPatch({ difficulty: 'hard' })).toEqual({ difficulty: 'hard' });
    expect(parseSettingsPatch({ totalRounds: 1 })).toEqual({ totalRounds: 1 });
    expect(parseSettingsPatch({ secondsPerFlag: 30 })).toEqual({ secondsPerFlag: 30 });

    expect(parseSettingsPatch({ difficulty: 'imposible' })).toBeNull();
    expect(parseSettingsPatch({ totalRounds: 7 })).toBeNull();
    expect(parseSettingsPatch({ secondsPerFlag: 3 })).toBeNull();
  });

  it('acepta cualquier entero del rango escribible en banderas por ronda', () => {
    expect(parseSettingsPatch({ flagsPerRound: 5 })).toEqual({ flagsPerRound: 5 });
    expect(parseSettingsPatch({ flagsPerRound: 37 })).toEqual({ flagsPerRound: 37 });
    expect(parseSettingsPatch({ flagsPerRound: 100 })).toEqual({ flagsPerRound: 100 });
  });

  it('rechaza banderas por ronda fuera de rango o que no sean enteros', () => {
    expect(parseSettingsPatch({ flagsPerRound: 4 })).toBeNull();
    expect(parseSettingsPatch({ flagsPerRound: 101 })).toBeNull();
    expect(parseSettingsPatch({ flagsPerRound: 12.5 })).toBeNull();
    expect(parseSettingsPatch({ flagsPerRound: 'muchas' })).toBeNull();
    expect(parseSettingsPatch({ flagsPerRound: NaN })).toBeNull();
    expect(parseSettingsPatch({ flagsPerRound: Infinity })).toBeNull();
  });

  it('acepta el juego y la configuración de Draw Battle', () => {
    expect(parseSettingsPatch({ kind: 'draw' })).toEqual({ kind: 'draw' });
    expect(parseSettingsPatch({ drawRounds: 15, drawSeconds: 90, drawPrompt: 'flag' })).toEqual({
      drawRounds: 15,
      drawSeconds: 90,
      drawPrompt: 'flag',
    });
  });

  it('rechaza valores de Draw Battle que no están en las opciones', () => {
    expect(parseSettingsPatch({ kind: 'ajedrez' })).toBeNull();
    expect(parseSettingsPatch({ drawRounds: 7 })).toBeNull();
    expect(parseSettingsPatch({ drawSeconds: 1 })).toBeNull();
    expect(parseSettingsPatch({ drawPrompt: 'emoji' })).toBeNull();
    // Un campo malo arrastra a todo el cambio, aunque el resto sea válido.
    expect(parseSettingsPatch({ kind: 'draw', drawSeconds: 5 })).toBeNull();
  });

  it('ignora campos desconocidos y payloads sin nada útil', () => {
    expect(parseSettingsPatch({ hackeado: true })).toBeNull();
    expect(parseSettingsPatch({})).toBeNull();
    expect(parseSettingsPatch(null)).toBeNull();
    expect(parseSettingsPatch([1, 2])).toBeNull();
    expect(parseSettingsPatch('rondas=99')).toBeNull();
  });
});

describe('tope de banderas por partida', () => {
  it('limita el máximo por ronda según cuántas rondas haya', () => {
    expect(maxFlagsPerRoundFor(1)).toBe(100);
    expect(maxFlagsPerRoundFor(2)).toBe(50);
    expect(maxFlagsPerRoundFor(3)).toBe(33);
    expect(maxFlagsPerRoundFor(5)).toBe(20);
  });

  it('acepta combinaciones dentro del tope y rechaza las que se pasan', () => {
    const base = DEFAULT_GAME_SETTINGS;
    expect(isValidSettings({ ...base, totalRounds: 5, flagsPerRound: 20 })).toBe(true);
    expect(isValidSettings({ ...base, totalRounds: 1, flagsPerRound: 100 })).toBe(true);
    expect(isValidSettings({ ...base, totalRounds: 5, flagsPerRound: 21 })).toBe(false);
    expect(isValidSettings({ ...base, totalRounds: 3, flagsPerRound: 50 })).toBe(false);
  });

  it('valida los campos de los dos juegos, sea cual sea el elegido', () => {
    expect(isValidSettings({ ...DEFAULT_GAME_SETTINGS, kind: 'draw' })).toBe(true);
    // Si no, cambiar de juego podría destapar un valor que nunca se revisó.
    expect(isValidSettings({ ...DEFAULT_GAME_SETTINGS, kind: 'guess', drawSeconds: 3 })).toBe(false);
    expect(isValidSettings({ ...DEFAULT_GAME_SETTINGS, kind: 'draw', flagsPerRound: 1 })).toBe(false);
  });

  it('fitsInGame responde por una combinación que todavía no es un settings', () => {
    // Es lo que necesita el lobby para deshabilitar opciones: preguntar por
    // "si eligiera 5 rondas" sin tener que armar un GameSettings entero.
    expect(fitsInGame(5, 20)).toBe(true);
    expect(fitsInGame(5, 21)).toBe(false);
    expect(fitsInGame(1, 100)).toBe(true);
    expect(fitsInGame(2, 51)).toBe(false);
  });

  /*
   * El lobby y el servidor tienen que decir siempre lo mismo.
   *
   * Antes el cliente rehacía la desigualdad a mano, así que este test es el que
   * avisa si la regla vuelve a vivir en dos lugares: si `isValidSettings` crece
   * un término y `fitsInGame` no (o al revés), acá se rompe.
   */
  it('fitsInGame y isValidSettings coinciden en todo el rango', () => {
    const base = DEFAULT_GAME_SETTINGS;
    for (const totalRounds of TOTAL_ROUNDS_OPTIONS) {
      for (let flagsPerRound = MIN_FLAGS_PER_ROUND; flagsPerRound <= MAX_FLAGS_PER_ROUND; flagsPerRound++) {
        expect(fitsInGame(totalRounds, flagsPerRound)).toBe(
          isValidSettings({ ...base, totalRounds, flagsPerRound }),
        );
      }
    }
  });
});
