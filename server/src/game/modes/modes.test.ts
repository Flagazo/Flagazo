import { describe, expect, it } from 'vitest';
import { FLASH_VISIBLE_MS, GAME_MODES, SECONDS_PER_FLAG_OPTIONS, SCORING } from '@flagazo/shared';
import type { GameModeId } from '@flagazo/shared';
import { COUNTRIES, getCountry } from '../../data/countries';
import { getMode } from './index';

const modo = (id: GameModeId) => getMode(id);

describe('registro de modos', () => {
  it('tiene todos los modos que declara el catálogo', () => {
    for (const info of GAME_MODES) {
      expect(getMode(info.id).id).toBe(info.id);
    }
  });

  it('un modo desconocido cae en normal en vez de romper la partida', () => {
    expect(getMode('inventado' as GameModeId).id).toBe('normal');
  });
});

describe('modos visuales', () => {
  it('los que se aclaran con el tiempo lo declaran, los grises no', () => {
    expect(modo('pixelated').presentation).toEqual({ effect: 'pixelated', fades: true });

    expect(modo('cropped').presentation).toEqual({ effect: 'cropped', fades: true });
    // Aflojar los grises sería mostrar el color, o sea regalar la respuesta.
    expect(modo('grayscale').presentation).toEqual({ effect: 'grayscale', fades: false });
  });

  it('el modo normal no aplica ningún efecto', () => {
    expect(modo('normal').presentation).toBeUndefined();
  });

  it('no cambian ni las banderas ni los tiempos', () => {
    for (const id of ['pixelated', 'cropped', 'grayscale'] as const) {
      expect(modo(id).pickFlags).toBeUndefined();
      expect(modo(id).flagDurationMs).toBeUndefined();
      expect(modo(id).missPenalty).toBeUndefined();
    }
  });
});

describe('modo parpadeo', () => {
  const flash = modo('flash');

  it('se ve un ratito y se tapa: el servidor dice cuánto', () => {
    expect(flash.presentation).toEqual({
      effect: 'flash',
      fades: false,
      // Del `shared`, no un número escrito acá: el cliente compara contra el
      // mismo valor y con dos copias una se iba a quedar vieja.
      visibleMs: FLASH_VISIBLE_MS,
    });
  });

  it('no se afloja con el tiempo, porque es todo o nada', () => {
    expect(flash.presentation!.fades).toBe(false);
  });

  it('el vistazo dura bastante menos que la bandera más corta posible', () => {
    // Si el fogonazo llegara a durar lo mismo que la bandera, el modo sería
    // el normal con otro nombre.
    const masCorta = Math.min(...SECONDS_PER_FLAG_OPTIONS) * 1000;
    expect(FLASH_VISIBLE_MS).toBeLessThan(masCorta / 4);
    expect(FLASH_VISIBLE_MS).toBeGreaterThan(0);
  });

  it('no toca ni las banderas ni los tiempos ni los puntos', () => {
    // El modo es una sola idea: cambia lo que ves, no las reglas.
    expect(flash.pickFlags).toBeUndefined();
    expect(flash.flagDurationMs).toBeUndefined();
    expect(flash.missPenalty).toBeUndefined();
  });
});

describe('modo parecidas', () => {
  const pick = (howMany: number) => modo('similar').pickFlags!(COUNTRIES, howMany);

  it('solo elige banderas que tengan alguna parecida declarada', () => {
    const elegidas = pick(20);
    expect(elegidas).toHaveLength(20);
    for (const country of elegidas) {
      expect(country.similarTo?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('las pone de a pares consecutivos, que es donde está la confusión', () => {
    const elegidas = pick(10);

    /*
     * Se cuentan las que tienen a una parecida al lado, mire para donde mire.
     * Mirar solo las posiciones pares sería de más: cuando a una bandera ya se
     * le usaron todas sus parecidas entra sola, y de ahí en adelante los pares
     * caen en las posiciones impares. Siguen estando pegados, que es lo único
     * que le importa al jugador.
     */
    const pegadas = elegidas.filter((country, i) => {
      const anterior = elegidas[i - 1];
      const siguiente = elegidas[i + 1];
      return (
        (anterior && country.similarTo?.includes(anterior.id)) ||
        (siguiente && country.similarTo?.includes(siguiente.id))
      );
    });
    expect(pegadas.length).toBeGreaterThanOrEqual(6);
  });

  it('devuelve la cantidad pedida aunque supere la cantidad de pares', () => {
    expect(pick(80)).toHaveLength(80);
    expect(pick(3)).toHaveLength(3);
  });

  it('las parejas son de verdad parecidas según el dataset', () => {
    // Chad y Rumania son el par clásico: casi idénticas.
    expect(getCountry('TD')!.similarTo).toContain('RO');
    expect(getCountry('RO')!.similarTo).toContain('TD');
  });
});

describe('modo bomba', () => {
  const bomba = modo('bomb');
  const duracion = (indexInRound: number, flagsPerRound = 5, baseDurationMs = 20_000) =>
    bomba.flagDurationMs!({ indexInRound, flagsPerRound, baseDurationMs });

  it('la mecha se acorta bandera a bandera', () => {
    const tiempos = [0, 1, 2, 3, 4].map((i) => duracion(i));
    // Cada una dura menos que la anterior.
    for (let i = 1; i < tiempos.length; i++) {
      expect(tiempos[i]!).toBeLessThan(tiempos[i - 1]!);
    }
    // La primera es la configurada; la última, bastante menos.
    expect(tiempos[0]).toBe(20_000);
    expect(tiempos[4]).toBe(6_000); // 30 % del tiempo base
  });

  it('nunca baja de un piso jugable', () => {
    // Con un tiempo base corto, el 30 % daría menos de 3 segundos.
    expect(duracion(4, 5, 5_000)).toBe(3_000);
    expect(duracion(9, 10, 10_000)).toBe(3_000);
  });

  it('con una sola bandera por ronda no hay mecha que acortar', () => {
    expect(duracion(0, 1, 20_000)).toBe(20_000);
  });

  it('quedarse sin responder cuesta puntos, a diferencia de los otros modos', () => {
    // Sale de `shared`, no de un -50 escrito acá: la pantalla de resultados lo
    // nombra, y con dos copias del número una de las dos iba a quedar vieja.
    expect(bomba.missPenalty).toBe(SCORING.bombMissPenalty);
    expect(bomba.missPenalty).toBeLessThan(0);
    expect(modo('normal').missPenalty).toBeUndefined();
  });

  it('no toca las banderas ni el efecto visual', () => {
    expect(bomba.pickFlags).toBeUndefined();
    expect(bomba.presentation).toBeUndefined();
  });
});
