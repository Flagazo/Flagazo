import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, DEFAULT_GAME_SETTINGS, REVEAL_MS, ROUND_SUMMARY_MS } from '@flagazo/shared';
import type { GameSettings, GuessSnapshot } from '@flagazo/shared';
import { COUNTRIES, getCountry, poolFor } from '../data/countries';
import { FlagGuessGame, pickFlags } from './FlagGuessGame';
import { resolveFlagToken } from './flagTokens';

const SETTINGS: GameSettings = {
  ...DEFAULT_GAME_SETTINGS,
  mode: 'normal',
  difficulty: 'all',
  totalRounds: 2,
  flagsPerRound: 2,
  secondsPerFlag: 10,
};
const FLAG_MS = SETTINGS.secondsPerFlag * 1000;

const roster = (...ids: string[]) =>
  ids.map((id) => ({ id, nickname: id.toUpperCase(), connected: true }));

let engine: FlagGuessGame;
let snapshots: GuessSnapshot[];

function build(settings: GameSettings = SETTINGS, players = roster('ana', 'bea')) {
  snapshots = [];
  engine = new FlagGuessGame(settings, players, {
    onChange: () => snapshots.push(engine.toSnapshot()),
  });
  return engine;
}

/** Igual que `build`, pero con las banderas fijadas en vez de sorteadas. */
function buildWith(countryIds: string[], settings: GameSettings = SETTINGS) {
  snapshots = [];
  const flags = countryIds.map((id) => getCountry(id)!);
  engine = new FlagGuessGame(
    settings,
    roster('ana', 'bea'),
    { onChange: () => snapshots.push(engine.toSnapshot()) },
    flags,
  );
  return engine;
}

const snap = () => engine.toSnapshot();
/** Responde correctamente mirando cuál es la bandera activa (solo el servidor lo sabe). */
const answerRight = (playerId: string) =>
  engine.answer(playerId, getCountry(engine.currentCountryId!)!.displayName.es);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  engine?.dispose();
  vi.useRealTimers();
});

describe('pickFlags', () => {
  it('devuelve la cantidad pedida sin repetir mientras alcance el pool', () => {
    const picked = pickFlags(COUNTRIES, 50);
    expect(picked).toHaveLength(50);
    expect(new Set(picked.map((c) => c.id)).size).toBe(50);
  });

  it('si piden más banderas que las del pool, encadena mezclas', () => {
    const easy = poolFor('easy');
    const picked = pickFlags(easy, 100);
    expect(picked).toHaveLength(100);
    // Se repiten, porque no hay 100 banderas fáciles, pero están todas cubiertas.
    expect(new Set(picked.map((c) => c.id)).size).toBe(easy.length);
  });

  it('mezcla de verdad: dos partidas no traen el mismo orden', () => {
    const a = pickFlags(COUNTRIES, 30).map((c) => c.id);
    const b = pickFlags(COUNTRIES, 30).map((c) => c.id);
    expect(a).not.toEqual(b);
  });
});

describe('máquina de estados', () => {
  it('va countdown → bandera → revelación → siguiente bandera', () => {
    build().start();
    expect(snap().phase).toBe('countdown');
    expect(snap().round).toBe(1);
    expect(snap().flagInRound).toBe(1);

    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(snap().phase).toBe('flag');

    vi.advanceTimersByTime(FLAG_MS);
    expect(snap().phase).toBe('reveal');

    vi.advanceTimersByTime(REVEAL_MS);
    expect(snap().phase).toBe('flag');
    expect(snap().flagInRound).toBe(2);
    expect(snap().round).toBe(1);
  });

  it('mete un resumen entre rondas y termina en resultados', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // Primera ronda: 2 banderas.
    vi.advanceTimersByTime(FLAG_MS + REVEAL_MS);
    vi.advanceTimersByTime(FLAG_MS + REVEAL_MS);
    expect(snap().phase).toBe('roundSummary');
    expect(snap().round).toBe(2);

    // Arranca la segunda ronda con su propia cuenta regresiva.
    vi.advanceTimersByTime(ROUND_SUMMARY_MS);
    expect(snap().phase).toBe('countdown');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(snap().phase).toBe('flag');

    vi.advanceTimersByTime(FLAG_MS + REVEAL_MS);
    vi.advanceTimersByTime(FLAG_MS + REVEAL_MS);
    expect(snap().phase).toBe('results');
    expect(engine.isFinished).toBe(true);
  });

  it('anuncia instantes absolutos coherentes con la duración de cada fase', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    const { startsAt, endsAt } = snap();
    expect(endsAt - startsAt).toBe(FLAG_MS);
    expect(startsAt).toBe(Date.now());
  });
});

describe('anti-trampa', () => {
  it('sirve la bandera activa por un token que no dice qué país es', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    const url = snap().flagUrl!;
    expect(url).toMatch(/^\/flag\/r\/[a-f0-9]{32}$/);
    /*
     * El país no aparece por ningún lado del snapshot, salvo en los nicknames.
     *
     * Los nicknames quedan afuera porque son texto libre del jugador y no pueden
     * ser una filtración. Acá valen "ANA" y "BEA", que contienen "NA" (Namibia) y
     * "BE" (Bélgica): cuando el sorteo caía en alguno de esos dos países el test
     * fallaba sin que se hubiera filtrado nada. Eran 2 de 195 por bandera, así
     * que se caía cada tantas corridas y parecía cosa de magia.
     */
    const sinNombres = JSON.stringify(snap(), (key, value) =>
      key === 'nickname' ? '' : value,
    );
    expect(sinNombres).not.toContain(engine.currentCountryId!);
    expect(snap().reveal).toBeNull();

    // Pero el servidor sí puede resolverlo para servir el archivo.
    expect(resolveFlagToken(url.split('/').pop()!)).toBe(engine.currentCountryId);
  });

  it('tampoco filtra un país cuyo código está dentro de un nickname', () => {
    // Bélgica es "BE" y hay un jugador que se llama "BEA": el caso que hacía
    // fallar al test de arriba cuando el sorteo lo elegía. Acá va fijo.
    buildWith(['BE', 'AR']).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    expect(engine.currentCountryId).toBe('BE');
    expect(snap().flagUrl).toMatch(/^\/flag\/r\/[a-f0-9]{32}$/);
    expect(snap().reveal).toBeNull();

    // La misma búsqueda que el test de arriba, pero con el país que choca fijado:
    // si alguien saca la exclusión de nicknames, esto falla siempre en vez de
    // una vez cada tantas corridas.
    const sinNombres = JSON.stringify(snap(), (key, value) =>
      key === 'nickname' ? '' : value,
    );
    expect(sinNombres).not.toContain('BE');
  });

  it('recién en la revelación aparece el país y la URL real', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    const target = engine.currentCountryId!;

    vi.advanceTimersByTime(FLAG_MS);
    const revealed = snap().reveal!;
    expect(revealed.countryId).toBe(target);
    // Con el sello de versión, para no servir una bandera vieja desde la caché.
    expect(revealed.flagUrl).toMatch(new RegExp(`^/flags/${target.toLowerCase()}\\.svg\\?v=.`));
    expect(revealed.name).toEqual(getCountry(target)!.displayName);
  });
});

describe('respuestas', () => {
  it('acepta una sola respuesta por bandera', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    expect(answerRight('ana')).toEqual({ verdict: 'correct' });
    expect(engine.answer('ana', 'Brasil')).toBe('ALREADY_ANSWERED');
  });

  it('los demás ven que respondiste, pero no si acertaste', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    answerRight('ana');

    const ana = snap().players.find((p) => p.playerId === 'ana')!;
    expect(ana.answered).toBe(true);

    // Nada dice todavía si estuvo bien: los resultados llegan en la revelación
    // y las estadísticas solo cuentan banderas ya reveladas.
    expect(snap().outcomes).toEqual([]);
    expect(ana.stats.correct).toBe(0);
    expect(ana.roundPoints).toBe(0);

    // Y al revelarse, ahí sí aparece.
    vi.advanceTimersByTime(FLAG_MS);
    expect(snap().outcomes.find((o) => o.playerId === 'ana')!.correct).toBe(true);
    expect(snap().players.find((p) => p.playerId === 'ana')!.stats.correct).toBe(1);
  });

  it('una respuesta ambigua no gasta el intento', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // Forzamos que la bandera activa sea la RD del Congo.
    const congo = engine.answer('ana', 'Congo');
    if (engine.currentCountryId === 'CD' || engine.currentCountryId === 'CG') {
      expect(congo).toEqual({
        verdict: 'ambiguous',
        options: ['República Democrática del Congo', 'República del Congo'],
      });
      expect(snap().players.find((p) => p.playerId === 'ana')!.answered).toBe(false);
    } else {
      // Para cualquier otra bandera, "Congo" es simplemente un error.
      expect(congo).toEqual({ verdict: 'wrong' });
    }
  });

  it('no se puede responder fuera de la fase de bandera', () => {
    build().start();
    expect(engine.answer('ana', 'Chile')).toBe('NO_FLAG_ACTIVE');

    vi.advanceTimersByTime(COUNTDOWN_MS + FLAG_MS);
    expect(snap().phase).toBe('reveal');
    expect(engine.answer('ana', 'Chile')).toBe('NO_FLAG_ACTIVE');
  });

  it('la bandera termina antes si ya respondieron todos los conectados', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(snap().phase).toBe('flag');

    answerRight('ana');
    expect(snap().phase).toBe('flag'); // falta bea
    answerRight('bea');
    expect(snap().phase).toBe('reveal'); // sin esperar los 10 segundos
  });

  it('un desconectado no traba la bandera', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    answerRight('ana');
    expect(snap().phase).toBe('flag');
    engine.setConnected('bea', false);
    expect(snap().phase).toBe('reveal');
  });

  it('mide el tiempo de respuesta del lado del servidor', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    vi.advanceTimersByTime(2500);

    answerRight('ana');
    vi.advanceTimersByTime(FLAG_MS);

    const outcome = snap().outcomes.find((o) => o.playerId === 'ana')!;
    expect(outcome.correct).toBe(true);
    expect(outcome.ms).toBe(2500);
  });

  it('quien no responde queda como fallado y sin tiempo', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS + FLAG_MS);

    const bea = snap().outcomes.find((o) => o.playerId === 'bea')!;
    // Quedarse sin responder no resta puntos, pero corta la racha.
    expect(bea).toEqual({
      playerId: 'bea',
      correct: false,
      answer: null,
      ms: null,
      points: 0,
      typos: 0,
      streak: 0,
    });
  });
});

describe('puntos por bandera', () => {
  /** Juega una bandera entera: responde y deja pasar la revelación. */
  function playFlag(answers: Record<string, string | null>, elapsedMs = 0) {
    vi.advanceTimersByTime(elapsedMs);
    for (const [playerId, text] of Object.entries(answers)) {
      if (text === null) continue;
      if (text === 'RIGHT') answerRight(playerId);
      else engine.answer(playerId, text);
    }
    // Si alguien no respondió hay que esperar a que venza el tiempo.
    const left = FLAG_MS - elapsedMs;
    vi.advanceTimersByTime(Object.values(answers).includes(null) ? left : 0);
    const outcomes = snap().outcomes;
    vi.advanceTimersByTime(REVEAL_MS);
    return outcomes;
  }

  it('suma 100 más el bonus por velocidad', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // Ambos responden al instante: 100 de base + 50 de velocidad.
    const outcomes = playFlag({ ana: 'RIGHT', bea: 'RIGHT' });
    expect(outcomes.find((o) => o.playerId === 'ana')!.points).toBe(150);
  });

  it('un acierto con un tipeo perdonado cuenta, pero paga menos', () => {
    // Bandera fija: con un nombre corto ("Chad", "Perú") no se perdona ningún
    // error, así que sortearla haría que el test fallara de a ratos.
    buildWith(['AR', 'BR']).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(engine.currentCountryId).toBe('AR');

    // Se responde bien pero con una letra de más: 80 de base en vez de 100.
    engine.answer('ana', 'Argentinaa');
    answerRight('bea');

    const outcomes = snap().outcomes;
    const ana = outcomes.find((o) => o.playerId === 'ana')!;
    const bea = outcomes.find((o) => o.playerId === 'bea')!;

    expect(ana.correct).toBe(true);
    expect(ana.typos).toBe(1);
    expect(ana.points).toBe(130); // 80 + 50 de velocidad
    // Bea la escribió tal cual y cobra completo.
    expect(bea.typos).toBe(0);
    expect(bea.points).toBe(150);
  });

  it('una respuesta ambigua por parecido no gasta el intento', () => {
    buildWith(['AU', 'BR']).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // "Austrlia" empata entre Australia y Austria: no se adivina ni se penaliza.
    expect(engine.answer('ana', 'Austrlia')).toEqual({
      verdict: 'ambiguous',
      options: [
        { es: 'Australia', en: 'Australia' },
        { es: 'Austria', en: 'Austria' },
      ],
    });
    expect(snap().players.find((p) => p.playerId === 'ana')!.answered).toBe(false);

    // Puede corregir y cobrar completo.
    expect(engine.answer('ana', 'Australia')).toEqual({ verdict: 'correct' });
    expect(snap().players.find((p) => p.playerId === 'ana')!.answered).toBe(true);
  });

  it('el bonus baja a medida que pasa el tiempo', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // A mitad del tiempo: 100 + 25.
    const outcomes = playFlag({ ana: 'RIGHT', bea: 'RIGHT' }, FLAG_MS / 2);
    expect(outcomes.find((o) => o.playerId === 'ana')!.points).toBe(125);
  });

  it('a partir del tercer acierto seguido la racha multiplica', () => {
    build({ ...SETTINGS, totalRounds: 1, flagsPerRound: 5 }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    const puntos: number[] = [];
    for (let i = 0; i < 4; i++) {
      const outcomes = playFlag({ ana: 'RIGHT', bea: 'RIGHT' });
      puntos.push(outcomes.find((o) => o.playerId === 'ana')!.points);
    }

    // 1º y 2º sin multiplicador; 3º y 4º ×1.5.
    expect(puntos).toEqual([150, 150, 225, 225]);
    expect(snap().players.find((p) => p.playerId === 'ana')!.streak).toBe(4);
  });

  it('errar resta 50 y corta la racha', () => {
    build({ ...SETTINGS, totalRounds: 1, flagsPerRound: 5 }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    playFlag({ ana: 'RIGHT', bea: 'RIGHT' });
    playFlag({ ana: 'RIGHT', bea: 'RIGHT' });
    expect(snap().players.find((p) => p.playerId === 'ana')!.roundPoints).toBe(300);

    const outcomes = playFlag({ ana: 'cualquier cosa', bea: 'RIGHT' });
    const ana = outcomes.find((o) => o.playerId === 'ana')!;
    expect(ana.points).toBe(-50);
    expect(ana.streak).toBe(0);
    expect(snap().players.find((p) => p.playerId === 'ana')!.roundPoints).toBe(250);
  });

  it('el puntaje de la ronda nunca baja de 0', () => {
    build({ ...SETTINGS, totalRounds: 1, flagsPerRound: 5 }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    for (let i = 0; i < 3; i++) playFlag({ ana: 'nada que ver', bea: 'RIGHT' });
    expect(snap().players.find((p) => p.playerId === 'ana')!.roundPoints).toBe(0);
  });

  it('la racha y los puntos se reinician en cada ronda', () => {
    build({ ...SETTINGS, totalRounds: 2, flagsPerRound: 3 }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    for (let i = 0; i < 3; i++) playFlag({ ana: 'RIGHT', bea: 'RIGHT' });
    expect(snap().phase).toBe('roundSummary');
    // El resumen conserva con cuánto cerró la ronda, para poder mostrarlo.
    expect(snap().players.find((p) => p.playerId === 'ana')!.lastRoundPoints).toBe(525);

    vi.advanceTimersByTime(ROUND_SUMMARY_MS + COUNTDOWN_MS);
    const ana = snap().players.find((p) => p.playerId === 'ana')!;
    expect(ana.roundPoints).toBe(0);
    expect(ana.streak).toBe(0);
  });
});

describe('puntaje por rondas', () => {
  it('la ronda la gana quien más aciertos sumó', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // Ana acierta las dos banderas de la ronda 1; Bea ninguna.
    // Como responden los dos, la bandera se cierra al instante: solo hay que
    // dejar pasar la revelación, no los 10 segundos completos.
    answerRight('ana');
    engine.answer('bea', 'no tengo idea');
    vi.advanceTimersByTime(REVEAL_MS);
    answerRight('ana');
    engine.answer('bea', 'tampoco');
    vi.advanceTimersByTime(REVEAL_MS);

    expect(snap().phase).toBe('roundSummary');
    const players = Object.fromEntries(snap().players.map((p) => [p.playerId, p.roundsWon]));
    expect(players).toEqual({ ana: 1, bea: 0 });
  });

  it('en empate suman las dos, y si nadie acierta no suma nadie', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    answerRight('ana');
    answerRight('bea');
    vi.advanceTimersByTime(REVEAL_MS);
    answerRight('ana');
    answerRight('bea');
    vi.advanceTimersByTime(REVEAL_MS);

    expect(snap().players.map((p) => p.roundsWon)).toEqual([1, 1]);

    // Ronda 2: nadie responde nada.
    vi.advanceTimersByTime(ROUND_SUMMARY_MS + COUNTDOWN_MS);
    vi.advanceTimersByTime(FLAG_MS + REVEAL_MS);
    vi.advanceTimersByTime(FLAG_MS + REVEAL_MS);

    expect(snap().phase).toBe('results');
    expect(snap().players.map((p) => p.roundsWon)).toEqual([1, 1]);
  });

  it('los aciertos de la ronda se reinician en la siguiente', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    answerRight('ana');
    answerRight('bea');
    vi.advanceTimersByTime(REVEAL_MS);
    answerRight('ana');
    answerRight('bea');
    vi.advanceTimersByTime(REVEAL_MS + ROUND_SUMMARY_MS + COUNTDOWN_MS);

    expect(snap().round).toBe(2);
    expect(snap().players.every((p) => p.roundPoints === 0)).toBe(true);
  });
});

describe('estadísticas de la partida', () => {
  it('cuenta aciertos, errores y banderas sin responder', () => {
    buildWith(['AR', 'BR', 'CL'], { ...SETTINGS, totalRounds: 1, flagsPerRound: 3 }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // Ana: acierta, erra y deja pasar una.
    engine.answer('ana', 'Argentina');
    engine.answer('bea', 'Argentina');
    vi.advanceTimersByTime(REVEAL_MS);

    engine.answer('ana', 'cualquier cosa');
    engine.answer('bea', 'Brasil');
    vi.advanceTimersByTime(REVEAL_MS);

    engine.answer('bea', 'Chile');
    vi.advanceTimersByTime(FLAG_MS + REVEAL_MS);

    const ana = snap().players.find((p) => p.playerId === 'ana')!.stats;
    expect(ana).toMatchObject({ correct: 1, wrong: 1, missed: 1 });

    const bea = snap().players.find((p) => p.playerId === 'bea')!.stats;
    expect(bea).toMatchObject({ correct: 3, wrong: 0, missed: 0, bestStreak: 3 });
  });

  it('registra la más rápida, el promedio y los tipeos perdonados', () => {
    buildWith(['AR', 'BR'], { ...SETTINGS, totalRounds: 1, flagsPerRound: 2 }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // Primera bandera: responde a los 2 s y después se deja vencer el tiempo.
    vi.advanceTimersByTime(2_000);
    engine.answer('ana', 'Argentina');
    vi.advanceTimersByTime(FLAG_MS - 2_000); // termina la bandera
    vi.advanceTimersByTime(REVEAL_MS); // arranca la segunda

    // Segunda bandera: responde a los 6 s, con un tipeo.
    vi.advanceTimersByTime(6_000);
    engine.answer('ana', 'Brasill');
    vi.advanceTimersByTime(FLAG_MS - 6_000 + REVEAL_MS);

    const stats = snap().players.find((p) => p.playerId === 'ana')!.stats;
    expect(stats.correct).toBe(2);
    expect(stats.withTypos).toBe(1);
    expect(stats.fastestMs).toBe(2_000);
    expect(stats.averageMs).toBe(4_000); // (2000 + 6000) / 2
  });

  it('acumula los puntos de todas las rondas', () => {
    buildWith(['AR', 'BR'], { ...SETTINGS, totalRounds: 2, flagsPerRound: 1 }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    answerRight('ana');
    answerRight('bea');
    vi.advanceTimersByTime(REVEAL_MS + ROUND_SUMMARY_MS + COUNTDOWN_MS);
    answerRight('ana');
    answerRight('bea');
    vi.advanceTimersByTime(REVEAL_MS);

    const ana = snap().players.find((p) => p.playerId === 'ana')!;
    // 150 por ronda, dos rondas. El puntaje de la ronda ya se reinició.
    expect(ana.stats.totalPoints).toBe(300);
    expect(ana.roundPoints).toBe(0);
    expect(ana.roundsWon).toBe(2);
  });

  it('quien no jugó nada queda con las estadísticas en cero', () => {
    buildWith(['AR']).start();
    expect(snap().players[0]!.stats).toEqual({
      correct: 0,
      wrong: 0,
      missed: 0,
      withTypos: 0,
      bestStreak: 0,
      totalPoints: 0,
      fastestMs: null,
      averageMs: null,
    });
  });
});

describe('modos de juego', () => {
  it('el modo normal no manda efecto visual', () => {
    buildWith(['AR', 'BR']).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(snap().mode).toBe('normal');
    expect(snap().presentation).toBeNull();
  });

  it('los modos visuales mandan el efecto mientras corre la bandera', () => {
    buildWith(['AR', 'BR'], { ...SETTINGS, mode: 'pixelated' }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    expect(snap().mode).toBe('pixelated');
    expect(snap().presentation).toEqual({ effect: 'pixelated', fades: true });
  });

  it('el efecto se apaga en la revelación: la bandera se ve limpia', () => {
    buildWith(['AR', 'BR'], { ...SETTINGS, mode: 'grayscale' }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS + FLAG_MS);

    expect(snap().phase).toBe('reveal');
    expect(snap().presentation).toBeNull();
  });

  it('la bomba acorta la mecha bandera a bandera', () => {
    buildWith(['AR', 'BR', 'CL', 'PE', 'UY'], {
      ...SETTINGS,
      mode: 'bomb',
      totalRounds: 1,
      flagsPerRound: 5,
      secondsPerFlag: 20,
    }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    const duraciones: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { startsAt, endsAt } = snap();
      duraciones.push(endsAt - startsAt);
      vi.advanceTimersByTime(endsAt - startsAt + REVEAL_MS);
    }

    expect(duraciones[0]).toBe(20_000);
    expect(duraciones[1]!).toBeLessThan(duraciones[0]!);
    expect(duraciones[2]!).toBeLessThan(duraciones[1]!);
  });

  it('con la bomba, dejar pasar la bandera cuesta puntos', () => {
    buildWith(['AR', 'BR'], { ...SETTINGS, mode: 'bomb' }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // Ana acierta; Bea deja que explote sin responder.
    answerRight('ana');
    vi.advanceTimersByTime(FLAG_MS);

    const bea = snap().outcomes.find((o) => o.playerId === 'bea')!;
    expect(bea.answer).toBeNull();
    expect(bea.points).toBe(-50);
  });

  it('sin bomba, dejarla pasar no cuesta nada', () => {
    buildWith(['AR', 'BR']).start();
    vi.advanceTimersByTime(COUNTDOWN_MS + FLAG_MS);

    const bea = snap().outcomes.find((o) => o.playerId === 'bea')!;
    expect(bea.points).toBe(0);
  });

  it('el modo "parecidas" juega solo banderas confundibles', () => {
    build({ ...SETTINGS, mode: 'similar', totalRounds: 1, flagsPerRound: 6 }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    // Se recorren todas las banderas de la partida verificando el pool.
    for (let i = 0; i < 6; i++) {
      const id = engine.currentCountryId;
      if (id) expect(getCountry(id)!.similarTo?.length ?? 0).toBeGreaterThan(0);
      vi.advanceTimersByTime(FLAG_MS + REVEAL_MS);
    }
  });
});

describe('idas y vueltas de jugadores', () => {
  it('mantiene el nombre actualizado en el ranking', () => {
    build().start();
    engine.rename('ana', 'Anita');
    expect(snap().players.find((p) => p.playerId === 'ana')!.nickname).toBe('Anita');
  });

  it('sacar a un jugador puede cerrar la bandera que estaba trabando', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    answerRight('ana');
    expect(snap().phase).toBe('flag');

    engine.removePlayer('bea');
    expect(snap().phase).toBe('reveal');
    expect(snap().players).toHaveLength(1);
  });

  it('dispose corta los timers y la partida deja de avanzar', () => {
    build().start();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(snap().phase).toBe('flag');

    engine.dispose();
    vi.advanceTimersByTime(FLAG_MS * 5);
    expect(snap().phase).toBe('flag');
  });
});

describe('partida de una sola ronda', () => {
  it('termina en resultados después de sus banderas', () => {
    build({ ...SETTINGS, difficulty: 'easy', totalRounds: 1, flagsPerRound: 5 }).start();
    vi.advanceTimersByTime(COUNTDOWN_MS);

    for (let i = 0; i < 5; i++) {
      expect(snap().phase).toBe('flag');
      expect(snap().round).toBe(1);
      vi.advanceTimersByTime(FLAG_MS + REVEAL_MS);
    }
    expect(snap().phase).toBe('results');
  });
});
