import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { GAME_MODES, PRECISION, SCORING } from '@flagazo/shared';
import type { AnswerFeedback, GameModeId, GamePlayer, GameSnapshot } from '@flagazo/shared';
import { AdSlot } from '../components/AdSlot';
import { Button } from '../components/Button';
import { FlagImage } from '../components/FlagImage';
import { useLocale, useT } from '../i18n';
import { avatarColor, avatarInitial } from '../lib/avatar';
import { errorMessage } from '../lib/errors';
import { useProgress, useSecondsLeft } from '../lib/useServerClock';
import { useReorder } from '../lib/useReorder';
import { useCountdownTick, useGameSounds } from '../audio/useGameSounds';
import { leaveParty, rematch, sendAnswer } from '../net/party';
import { selectIsHost, useAppStore } from '../store/useAppStore';
import './GameScreen.css';

export function GameScreen() {
  const room = useAppStore((s) => s.room);
  const game = room?.game ?? null;

  // Los sonidos se enganchan acá arriba para que sigan sonando aunque cambie
  // la fase y se desmonte la pantalla de abajo.
  useGameSounds(game);

  // Entre que termina la partida y llega el snapshot nuevo puede faltar el estado.
  if (!room || !game) return null;

  const isPlaying = game.phase === 'flag' || game.phase === 'reveal' || game.phase === 'countdown';

  return (
    <main className="screen game-screen">
      <GameHeader game={game} />

      {/* Durante el juego la tabla va al costado de la bandera; en los resúmenes
          el ranking ya es el protagonista y no hace falta repetirlo. */}
      <div className={`game-body ${isPlaying ? 'game-body--with-board' : ''}`}>
        {isPlaying && <Standings game={game} />}

        <div className="game-main">
          {game.phase === 'countdown' && <Countdown game={game} />}
          {(game.phase === 'flag' || game.phase === 'reveal') && <FlagStage game={game} />}
          {game.phase === 'roundSummary' && <RoundSummary game={game} />}
          {game.phase === 'results' && <Results game={game} />}
        </div>
      </div>
    </main>
  );
}

// ── Encabezado ──────────────────────────────────────────────

function GameHeader({ game }: { game: GameSnapshot }) {
  const t = useT();
  const label =
    game.totalRounds === 1
      ? t.game.flagOf(game.flagInRound, game.flagsPerRound)
      : t.game.roundAndFlag(game.round, game.totalRounds, game.flagInRound, game.flagsPerRound);

  const mode = GAME_MODES.find((info) => info.id === game.mode);

  return (
    <header className="game-header">
      <span className="game-header__progress">{game.phase === 'results' ? t.game.final : label}</span>
      {/* El modo se recuerda todo el tiempo: cambia cómo se lee lo que ves. */}
      {mode && mode.id !== 'normal' && (
        <span className="game-header__mode" title={t.modes[mode.id].description}>
          <span aria-hidden="true">{mode.emoji}</span> {t.modes[mode.id].name}
        </span>
      )}
    </header>
  );
}

/**
 * Tabla de posiciones al costado de la bandera.
 *
 * Muestra las dos escalas a la vez: los puntos de la ronda que se está jugando
 * (que es lo que se mueve bandera a bandera) y las rondas ganadas, que es el
 * marcador que define la partida.
 */
function Standings({ game }: { game: GameSnapshot }) {
  const myId = useAppStore((s) => s.session.playerId);
  const t = useT();
  const listRef = useRef<HTMLOListElement>(null);
  // Cuando alguien pasa a otro, las filas viajan en vez de saltar.
  useReorder(listRef);

  const ranked = [...game.players].sort(
    (a, b) => b.roundsWon - a.roundsWon || b.roundPoints - a.roundPoints,
  );

  return (
    <aside className="standings" aria-label={t.game.standings}>
      <header className="standings__head">
        <span className="standings__title">{t.game.standingsTitle}</span>
        {/* Las dos escalas conviven en la misma fila, así que cada una dice qué es:
            los puntos son de la ronda en curso, el trofeo son rondas ganadas. */}
        <span className="standings__legend">
          <span title={t.game.pointsThisRound}>{t.common.points}</span>
          <span title={t.game.roundsWon} aria-label={t.game.roundsWon}>
            🏆
          </span>
        </span>
      </header>

      <ol className="standings__list" ref={listRef}>
        {ranked.map((player, position) => (
          <li
            key={player.playerId}
            data-reorder-key={player.playerId}
            className={[
              'standings__row',
              player.playerId === myId ? 'standings__row--me' : '',
              player.connected ? '' : 'standings__row--away',
              player.answered && game.phase === 'flag' ? 'standings__row--answered' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="standings__position">{position + 1}</span>
            <span
              className="standings__avatar"
              style={{ background: avatarColor(player.playerId) }}
            >
              {avatarInitial(player.nickname)}
            </span>

            <span className="standings__name">
              {player.nickname}
              {/* La racha solo aparece cuando ya multiplica. La key la hace
                  latir de nuevo en cada acierto encadenado. */}
              {player.streak >= 3 && (
                <span
                  key={player.streak}
                  className="standings__streak"
                  title={t.game.streakTitle(player.streak, multiplierFor(player.streak))}
                >
                  🔥{player.streak}
                </span>
              )}
            </span>

            {/* La key hace que el número palpite cuando cambia. */}
            <span key={player.roundPoints} className="standings__points">
              {player.roundPoints}
            </span>
            <span className="standings__rounds">{player.roundsWon}</span>
          </li>
        ))}
      </ol>

      <WaitingPlayers />
    </aside>
  );
}

/** Solo para el título del 🔥: la cuenta real la hace el servidor. */
function multiplierFor(streak: number): number {
  if (streak >= 10) return 3;
  if (streak >= 5) return 2;
  return 1.5;
}

/**
 * Los que entraron con la partida ya empezada.
 *
 * Están en la party pero no en la partida, así que no aparecen en la tabla:
 * sin esto no habría ninguna señal de que están ahí esperando.
 */
function WaitingPlayers() {
  // Se selecciona el array tal cual y se filtra afuera: un selector que devuelve
  // un array nuevo en cada llamada hace que zustand vea siempre un cambio y
  // entre en un bucle de renders.
  const players = useAppStore((s) => s.room?.players);
  const t = useT();
  const waiting = players?.filter((player) => player.waiting) ?? [];
  if (waiting.length === 0) return null;

  return (
    <p className="standings__waiting">
      <span className="standings__waiting-label">{t.game.playingNext}</span>
      {waiting.map((player) => player.nickname).join(', ')}
    </p>
  );
}

// ── Cuenta regresiva ────────────────────────────────────────

function Countdown({ game }: { game: GameSnapshot }) {
  const seconds = useSecondsLeft(game.endsAt);
  const t = useT();
  useCountdownTick(seconds, true);

  return (
    <section className="countdown">
      <p className="countdown__round">
        {game.totalRounds === 1 ? t.game.letsGo : t.game.roundNumber(game.round)}
      </p>
      {/* La key reinicia la animación en cada número. */}
      <p key={seconds} className="countdown__number">
        {seconds > 0 ? seconds : t.game.now}
      </p>
    </section>
  );
}

// ── Bandera y respuesta ─────────────────────────────────────

function FlagStage({ game }: { game: GameSnapshot }) {
  const t = useT();
  const locale = useLocale();
  const revealing = game.phase === 'reveal';
  // Se calcula una sola vez acá y baja: los efectos que se aflojan y la barra de
  // tiempo miran el mismo reloj, así no hay dos animaciones desincronizadas.
  const progress = useProgress(game.startsAt, game.endsAt);
  // Los dos instantes son del reloj del servidor, así que la resta es la
  // duración real y no hace falta corregir el desfasaje del cliente.
  const elapsedMs = progress * (game.endsAt - game.startsAt);

  return (
    <section className="flag-stage">
      <div className={`flag-card ${revealing ? 'flag-card--revealed' : ''}`}>
        {game.flagUrl && (
          <FlagImage
            key={game.flagUrl}
            url={game.flagUrl}
            alt={
              revealing
                ? (game.reveal ? game.reveal.name[locale] : t.game.flagAlt)
                : t.game.guessAlt
            }
            presentation={game.presentation}
            progress={progress}
            elapsedMs={elapsedMs}
          />
        )}
      </div>

      {revealing ? <Reveal game={game} /> : <ActiveFlag game={game} progress={progress} />}
    </section>
  );
}

function ActiveFlag({ game, progress }: { game: GameSnapshot; progress: number }) {
  const seconds = useSecondsLeft(game.endsAt);
  const t = useT();
  const remaining = 1 - progress;

  /*
   * Tensión final en dos escalones, para que no sea todo o nada:
   * primero la barra se pone roja, y en los últimos 5 segundos late todo el
   * bloque y suena el tic-tac. Cinco segundos es el rato en el que todavía se
   * puede escribir algo, así que apura sin ser una condena.
   */
  const urgent = remaining < 0.25;
  const critical = seconds > 0 && seconds <= 5;
  useCountdownTick(seconds, critical);

  return (
    <>
      <div
        className={`time-bar ${critical ? 'time-bar--critical' : ''}`}
        role="timer"
        aria-label={t.game.secondsLeft(seconds)}
      >
        <div
          className={`time-bar__fill ${urgent ? 'time-bar__fill--urgent' : ''}`}
          style={{ transform: `scaleX(${remaining})` }}
        />
        {/* La key hace saltar el número en cada segundo del tramo final. */}
        <span key={critical ? seconds : 'calm'} className="time-bar__seconds">
          {seconds}
        </span>
      </div>

      {/* Quién ya respondió se ve en la tabla de posiciones, no hace falta repetirlo. */}
      <AnswerForm key={`${game.round}-${game.flagInRound}`} game={game} />
    </>
  );
}

function AnswerForm({ game }: { game: GameSnapshot }) {
  const myId = useAppStore((s) => s.session.playerId);
  const pushToast = useAppStore((s) => s.pushToast);
  const t = useT();
  const me = game.players.find((player) => player.playerId === myId);

  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Bandera nueva: el foco vuelve al campo sin tener que tocar la pantalla.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Quien entró con la partida empezada mira, pero no juega hasta la próxima.
  if (!me) {
    return <p className="answer-waiting">{t.game.joinedLate}</p>;
  }

  const locked = me.answered;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || locked || sending) return;

    setSending(true);
    const result = await sendAnswer(value);
    setSending(false);

    if (!result.ok) {
      pushToast(errorMessage(result.error), 'error');
      return;
    }
    setFeedback(result.feedback);
    // Una respuesta ambigua no gasta el intento: se limpia para reintentar.
    if (result.feedback.verdict === 'ambiguous') {
      setText('');
      inputRef.current?.focus();
    }
  }

  return (
    <form className="answer" onSubmit={(e) => void handleSubmit(e)}>
      <div className={`answer__field ${feedback ? `answer__field--${feedback.verdict}` : ''}`}>
        <input
          ref={inputRef}
          className="answer__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={locked ? t.game.answerSent : t.game.answerPlaceholder}
          disabled={locked || sending}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          aria-label={t.game.yourAnswer}
        />
        <Button type="submit" disabled={locked || sending || text.trim().length === 0}>
          {locked ? '✓' : t.game.send}
        </Button>
      </div>

      {feedback && <FeedbackLine feedback={feedback} />}
    </form>
  );
}

function FeedbackLine({ feedback }: { feedback: AnswerFeedback }) {
  const t = useT();
  const locale = useLocale();

  if (feedback.verdict === 'ambiguous') {
    // El servidor manda los nombres en los dos idiomas: acá se elige uno.
    const options = (feedback.options ?? []).map((name) => name[locale]);
    return (
      <p className="answer__feedback answer__feedback--ambiguous">
        {t.game.feedback.ambiguous(options.join(t.game.feedback.or))}
      </p>
    );
  }
  return (
    <p className={`answer__feedback answer__feedback--${feedback.verdict}`}>
      {t.game.feedback[feedback.verdict]}
    </p>
  );
}

// ── Revelación ──────────────────────────────────────────────

function Reveal({ game }: { game: GameSnapshot }) {
  const myId = useAppStore((s) => s.session.playerId);
  const t = useT();
  const locale = useLocale();
  const nameOf = new Map(game.players.map((player) => [player.playerId, player.nickname]));
  // Los que acertaron primero arriba; los que no, al final.
  const sorted = [...game.outcomes].sort((a, b) => {
    if (a.correct !== b.correct) return a.correct ? -1 : 1;
    return (a.ms ?? Infinity) - (b.ms ?? Infinity);
  });

  return (
    <section className="reveal">
      {/* Sin el emoji de bandera a propósito: Windows lo dibuja como dos letras
          ("TR Turquía") y la bandera de verdad ya está acá arriba. */}
      <h2 className="reveal__name">{game.reveal?.name[locale]}</h2>

      <ul className="reveal__list">
        {sorted.map((outcome) => (
          <li
            key={outcome.playerId}
            className={`reveal__row ${outcome.correct ? 'reveal__row--ok' : 'reveal__row--miss'} ${
              outcome.playerId === myId ? 'reveal__row--me' : ''
            }`}
          >
            <span
              className="reveal__mark"
              aria-hidden="true"
              title={outcome.typos > 0 ? t.game.typosForgiven : undefined}
            >
              {outcome.correct ? (outcome.typos > 0 ? '🟢' : '✅') : '❌'}
            </span>
            <span className="reveal__player">
              {nameOf.get(outcome.playerId)}
              {outcome.correct && outcome.streak >= 3 && (
                <span className="reveal__streak" title={t.game.streakOf(outcome.streak)}>
                  🔥{outcome.streak}
                </span>
              )}
            </span>
            <span className="reveal__answer">{outcome.answer ?? t.game.noAnswer}</span>
            <span className="reveal__time">
              {outcome.ms !== null ? `${(outcome.ms / 1000).toFixed(1)}s` : '—'}
            </span>
            <span
              className={`reveal__points ${outcome.points > 0 ? 'reveal__points--gain' : outcome.points < 0 ? 'reveal__points--loss' : ''}`}
            >
              {outcome.points > 0 ? `+${outcome.points}` : outcome.points}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Resumen de ronda y resultados ───────────────────────────

function RoundSummary({ game }: { game: GameSnapshot }) {
  const t = useT();
  // Quién ganó la ronda que acaba de cerrar: el que más puntos hizo en ella.
  const byLastRound = [...game.players].sort((a, b) => b.lastRoundPoints - a.lastRoundPoints);
  const best = byLastRound[0]?.lastRoundPoints ?? 0;
  const winners = byLastRound.filter((player) => player.lastRoundPoints === best && best > 0);

  const ranking = [...game.players].sort(
    (a, b) => b.roundsWon - a.roundsWon || b.lastRoundPoints - a.lastRoundPoints,
  );

  return (
    <section className="card summary">
      <h2 className="summary__title">{t.game.roundOver(game.round - 1)}</h2>
      <p className="summary__lead">
        {winners.length === 0
          ? t.game.noRoundWinner
          : t.game.roundWinner(
              winners.map((p) => p.nickname).join(t.game.and),
              winners.length > 1,
              best,
            )}
      </p>
      <Ranking
        players={ranking}
        pointsOf={(player) => player.lastRoundPoints}
        pointsLabel={t.game.pointsThisRound}
      />
      <p className="summary__next">{t.game.nextRound(game.round)}</p>
    </section>
  );
}

function Results({ game }: { game: GameSnapshot }) {
  const isHost = useAppStore(selectIsHost);
  const pushToast = useAppStore((s) => s.pushToast);
  const t = useT();
  const [busy, setBusy] = useState(false);

  const ranking = [...game.players].sort((a, b) => b.roundsWon - a.roundsWon);
  const top = ranking[0]?.roundsWon ?? 0;
  const winners = ranking.filter((player) => player.roundsWon === top && top > 0);

  async function handleRematch() {
    setBusy(true);
    const result = await rematch();
    setBusy(false);
    if (!result.ok) pushToast(errorMessage(result.error), 'error');
  }

  return (
    <section className="card summary summary--final">
      <p className="summary__crown" aria-hidden="true">🏆</p>
      <h2 className="summary__title">
        {/* "Sin ganador" no es lo mismo que "nadie acertó": se puede acertar
            alguna y terminar la ronda en 0 por las penalizaciones. */}
        {winners.length === 0
          ? t.game.noWinner
          : winners.length === 1
            ? t.game.winner(winners[0]!.nickname)
            : t.game.tie(winners.map((p) => p.nickname).join(t.game.and))}
      </h2>

      <Ranking
        players={ranking}
        pointsOf={(player) => player.stats.totalPoints}
        pointsLabel={t.game.pointsTotal}
      />
      {/* La regla que decide la partida, escrita: si no, un jugador con más
          puntos y menos rondas queda segundo sin entender por qué. */}
      <p className="summary__rule">{t.game.winnerRule}</p>

      <GameStats players={ranking} />
      <ScoringHelp mode={game.mode} />

      <AdSlot placement="results" />

      <div className="summary__actions">
        <Button variant="ghost" onClick={() => void leaveParty()} disabled={busy}>
          {t.common.leave}
        </Button>
        {isHost ? (
          <Button variant="green" size="lg" icon="↻" onClick={() => void handleRematch()} disabled={busy}>
            {t.game.rematch}
          </Button>
        ) : (
          <p className="summary__waiting">{t.common.waitingForHost}</p>
        )}
      </div>
    </section>
  );
}

const segundos = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);

/**
 * De dónde salió cada puntaje.
 *
 * Va plegado: al terminar la partida lo que se quiere ver es quién ganó, no un
 * reglamento. Pero la pregunta "¿por qué tengo estos puntos?" aparece siempre,
 * y hasta ahora la respuesta solo estaba en el README.
 *
 * Los números salen de `SCORING` y `PRECISION`, no escritos a mano: si algún día
 * se recalibra el balance, este texto se actualiza solo en vez de mentir.
 */
function ScoringHelp({ mode }: { mode: GameModeId }) {
  const t = useT();

  // Del multiplicador más bajo al más alto, que es el orden en que se viven.
  const tiers = [...SCORING.streakTiers]
    .sort((a, b) => a.from - b.from)
    .map((tier) => `${tier.from} → ×${tier.multiplier}`)
    .join(' · ');

  return (
    <details className="scoring">
      <summary className="scoring__summary">{t.game.scoring.title}</summary>
      <ul className="scoring__list">
        <li>{t.game.scoring.correct(SCORING.base, SCORING.maxSpeedBonus)}</li>
        <li>
          {t.game.scoring.typos(
            Math.round(PRECISION.oneTypo * 100),
            Math.round(PRECISION.moreTypos * 100),
          )}
        </li>
        <li>{t.game.scoring.streak(tiers)}</li>
        {/* Se pasa en positivo: la frase ya dice "cuesta", y "cuesta -50" es un
            doble negativo que se lee al revés de lo que pasa. */}
        <li>{t.game.scoring.wrong(Math.abs(SCORING.wrongPenalty))}</li>
        {/* La bomba es el único modo que además castiga no responder. */}
        {mode === 'bomb' && <li>{t.game.scoring.missed(Math.abs(SCORING.bombMissPenalty))}</li>}
        <li>{t.game.scoring.rounds}</li>
      </ul>
    </details>
  );
}

/**
 * Estadísticas de la partida.
 *
 * Primero los "destacados" (quién fue el más rápido, quién hizo la racha más
 * larga), que es lo que se comenta en voz alta al terminar, y después la tabla
 * completa para el que quiera mirar el detalle.
 */
function GameStats({ players }: { players: GamePlayer[] }) {
  const myId = useAppStore((s) => s.session.playerId);
  const t = useT();
  const jugaron = players.filter((p) => p.stats.correct + p.stats.wrong + p.stats.missed > 0);
  if (jugaron.length === 0) return null;

  const conAciertos = jugaron.filter((p) => p.stats.fastestMs !== null);
  const masRapido = conAciertos.reduce<GamePlayer | null>(
    (mejor, p) => (!mejor || p.stats.fastestMs! < mejor.stats.fastestMs! ? p : mejor),
    null,
  );
  const mejorRacha = jugaron.reduce<GamePlayer | null>(
    (mejor, p) => (!mejor || p.stats.bestStreak > mejor.stats.bestStreak ? p : mejor),
    null,
  );

  return (
    <section className="stats">
      <h3 className="stats__title">{t.game.statsTitle}</h3>

      <div className="stats__highlights">
        {masRapido && (
          <p className="stats__highlight">
            <span aria-hidden="true">⚡</span>{' '}
            {t.game.fastestIn(masRapido.nickname, segundos(masRapido.stats.fastestMs))}
          </p>
        )}
        {mejorRacha && mejorRacha.stats.bestStreak >= 3 && (
          <p className="stats__highlight">
            <span aria-hidden="true">🔥</span>{' '}
            {t.game.bestStreak(mejorRacha.nickname, mejorRacha.stats.bestStreak)}
          </p>
        )}
      </div>

      <div className="stats__scroll">
        <table className="stats__table">
          <thead>
            <tr>
              {/* Emoji y palabra: el emoji solo se leía por el `title`, que en un
                  celular no existe porque no hay con qué hacer hover. */}
              <th scope="col">{t.game.table.player}</th>
              <th scope="col" title={t.game.table.correct}>
                <span aria-hidden="true">✅</span> {t.game.table.correctShort}
              </th>
              <th scope="col" title={t.game.table.wrong}>
                <span aria-hidden="true">❌</span> {t.game.table.wrongShort}
              </th>
              <th scope="col" title={t.game.table.missed}>
                <span aria-hidden="true">⌛</span> {t.game.table.missedShort}
              </th>
              <th scope="col" title={t.game.table.streak}>
                <span aria-hidden="true">🔥</span> {t.game.table.streakShort}
              </th>
              <th scope="col" title={t.game.table.fastest}>
                <span aria-hidden="true">⚡</span> {t.game.table.fastestShort}
              </th>
              <th scope="col" title={t.game.table.average}>
                <span aria-hidden="true">⌀</span> {t.game.table.averageShort}
              </th>
              <th scope="col" title={t.game.table.points}>{t.game.table.pointsShort}</th>
            </tr>
          </thead>
          <tbody>
            {jugaron.map((player) => (
              <tr
                key={player.playerId}
                className={player.playerId === myId ? 'stats__row--me' : undefined}
              >
                <th scope="row" className="stats__player">
                  {player.nickname}
                  {/* Los aciertos con tipeo perdonado se aclaran acá y no en la columna
                      de aciertos, para no ensuciar la lectura rápida. */}
                  {player.stats.withTypos > 0 && (
                    <span className="stats__typos" title={t.game.typosForgiven}>
                      🟢{player.stats.withTypos}
                    </span>
                  )}
                </th>
                <td>{player.stats.correct}</td>
                <td>{player.stats.wrong}</td>
                <td>{player.stats.missed}</td>
                <td>{player.stats.bestStreak}</td>
                <td>{segundos(player.stats.fastestMs)}</td>
                <td>{segundos(player.stats.averageMs)}</td>
                <td className="stats__points">{player.stats.totalPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * El ranking, con las columnas tituladas.
 *
 * El puntaje se pasa como función y con su nombre en vez de con un booleano
 * por variante: el problema de esta tabla era justamente que "pts" significaba
 * cosas distintas según la pantalla (los de la ronda que cerró, los de toda la
 * partida) y nada lo decía. Así, quien la usa está obligado a nombrar qué muestra.
 */
function Ranking({
  players,
  pointsOf,
  pointsLabel,
}: {
  players: GamePlayer[];
  pointsOf: (player: GamePlayer) => number;
  pointsLabel: string;
}) {
  const myId = useAppStore((s) => s.session.playerId);
  const t = useT();

  return (
    <div className="ranking-block">
      <div className="ranking__head">
        <span className="ranking__head-name">{t.game.table.player}</span>
        <span className="ranking__head-col">{t.game.roundsWonColumn}</span>
        <span className="ranking__head-col">{pointsLabel}</span>
      </div>

      <ol className="ranking">
        {players.map((player, position) => (
          <li
            key={player.playerId}
            className={`ranking__row ${player.playerId === myId ? 'ranking__row--me' : ''}`}
          >
            <span className="ranking__position">{position + 1}</span>
            <span className="ranking__avatar" style={{ background: avatarColor(player.playerId) }}>
              {avatarInitial(player.nickname)}
            </span>
            <span className="ranking__name">{player.nickname}</span>
            {/* Las rondas en amarillo y grandes: son las que definen la partida. */}
            <span className="ranking__score" title={t.game.roundsWon}>
              {player.roundsWon}
            </span>
            <span className="ranking__points" title={pointsLabel}>
              {pointsOf(player)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
