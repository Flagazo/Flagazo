import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DRAW_DEFAULT_BRUSH,
  DRAW_DEFAULT_COLOR,
  DRAW_DRAFT_INTERVAL_MS,
  DRAW_LIMITS,
  DRAW_REVEAL_TIMING,
  countPoints,
  decodeDrawing,
  encodeDrawing,
} from '@flagazo/shared';
import type { DrawEntry, DrawPlayer, DrawSnapshot, DrawTool, Stroke } from '@flagazo/shared';
import { useCountdownTick } from '../audio/useGameSounds';
import { AdSlot } from '../components/AdSlot';
import { Button } from '../components/Button';
import { WaitingPlayers } from '../components/WaitingPlayers';
import { DrawCanvas } from '../components/draw/DrawCanvas';
import type { Brush, DrawCanvasHandle } from '../components/draw/DrawCanvas';
import { DrawToolbar } from '../components/draw/DrawToolbar';
import { DrawingView } from '../components/draw/DrawingView';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { ShareResult } from '../components/ShareResult';
import { useLocale, useT } from '../i18n';
import { errorMessage } from '../lib/errors';
import { storage } from '../lib/storage';
import { useProgress, useSecondsLeft } from '../lib/useServerClock';
import { useReorder } from '../lib/useReorder';
import { serverNow } from '../net/clock';
import { leaveParty, rematch, submitDrawing } from '../net/party';
import { selectIsHost, useAppStore } from '../store/useAppStore';
import './GameScreen.css';
import './DrawBattleScreen.css';

/**
 * Draw Battle: todos dibujan la misma bandera y gana el mejor dibujo.
 *
 * La pantalla solo refleja el snapshot. Lo único propio del cliente es el dibujo
 * en curso, que vive acá hasta que se manda: nadie más lo ve mientras se dibuja.
 */
export function DrawBattleScreen({ game }: { game: DrawSnapshot }) {
  const playing = game.phase !== 'results';
  const drawing = game.phase === 'drawing' || game.phase === 'judging';

  return (
    <main className="screen game-screen draw-screen">
      <DrawHeader game={game} />

      <div className={`draw-body ${playing ? 'draw-body--with-board' : ''} ${drawing ? 'draw-body--drawing' : ''}`}>
        {playing && <DrawStandings game={game} />}

        <div className="game-main draw-main">
          {game.phase === 'countdown' && <DrawCountdown game={game} />}
          {/* La key reinicia el lienzo en cada ronda: el dibujo de la anterior no se arrastra. */}
          {drawing && <DrawingStage key={game.round} game={game} />}
          {game.phase === 'reveal' && <RevealStage key={game.round} game={game} />}
          {game.phase === 'results' && <DrawResults game={game} />}
        </div>
      </div>
    </main>
  );
}

// ── Encabezado y tabla ──────────────────────────────────────

function DrawHeader({ game }: { game: DrawSnapshot }) {
  const t = useT();
  return (
    <header className="game-header">
      <span className="game-header__progress">
        {game.phase === 'results' ? t.game.final : t.draw.roundOf(game.round, game.totalRounds)}
      </span>
      <span className="game-header__mode draw-badge">
        <span aria-hidden="true">🎨</span> {t.kinds.draw.name}
      </span>
    </header>
  );
}

const byStanding = (a: DrawPlayer, b: DrawPlayer) =>
  b.points - a.points || b.roundsWon - a.roundsWon || b.totalScore - a.totalScore;

function DrawStandings({ game }: { game: DrawSnapshot }) {
  const myId = useAppStore((s) => s.session.playerId);
  const t = useT();
  const listRef = useRef<HTMLOListElement>(null);
  useReorder(listRef);

  const ranked = [...game.players].sort(byStanding);
  const drawing = game.phase === 'drawing' || game.phase === 'judging';

  return (
    <aside className="standings draw-standings" aria-label={t.game.standings}>
      <header className="standings__head">
        <span className="standings__title">{t.draw.standings}</span>
        <span className="standings__legend">
          <span title={t.draw.pointsTitle} aria-label={t.draw.pointsTitle}>🏆</span>
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
              drawing && player.finished ? 'standings__row--answered' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="standings__position">{position + 1}</span>
            <PlayerAvatar className="standings__avatar" playerId={player.playerId} nickname={player.nickname} />
            <span className="standings__name">{player.nickname}</span>
            <span className="draw-standings__status" aria-hidden="true">
              {drawing ? (player.finished ? '✓' : '✏️') : ''}
            </span>
            <span key={player.points} className="standings__points">{player.points}</span>
          </li>
        ))}
      </ol>

      <WaitingPlayers />
    </aside>
  );
}

function DrawCountdown({ game }: { game: DrawSnapshot }) {
  const seconds = useSecondsLeft(game.endsAt);
  const t = useT();
  useCountdownTick(seconds, true);

  return (
    <section className="countdown">
      <p className="countdown__round">{t.game.roundNumber(game.round)}</p>
      <p key={seconds} className="countdown__number draw-countdown__number">
        {seconds > 0 ? seconds : t.game.now}
      </p>
    </section>
  );
}

// ── Dibujar ─────────────────────────────────────────────────

interface History {
  past: Stroke[][];
  present: Stroke[];
  future: Stroke[][];
}

/** Deshacer tiene memoria, pero no infinita. */
const MAX_HISTORY = 200;

function DrawingStage({ game }: { game: DrawSnapshot }) {
  const t = useT();
  const myId = useAppStore((s) => s.session.playerId);
  const code = useAppStore((s) => s.room?.code ?? '');
  const pushToast = useAppStore((s) => s.pushToast);
  const me = game.players.find((player) => player.playerId === myId);

  // Si hay un borrador guardado de esta ronda (F5 a mitad del dibujo), se retoma.
  const [history, setHistory] = useState<History>(() => {
    const saved = decodeDrawing(storage.getDraft(code, game.round));
    return { past: [], present: saved.ok ? saved.drawing.strokes : [], future: [] };
  });
  // El pincel vive dos veces a propósito: en estado, para que la barra se vea
  // elegida, y en una referencia que el lienzo lee al empezar cada trazo. La
  // referencia cambia en el mismo clic; el estado, recién en el próximo render.
  const [tool, setToolState] = useState<DrawTool>('brush');
  const [color, setColorState] = useState<string>(DRAW_DEFAULT_COLOR);
  const [size, setSizeState] = useState(DRAW_DEFAULT_BRUSH);
  const brush = useRef<Brush>({ tool: 'brush', color: DRAW_DEFAULT_COLOR, size: DRAW_DEFAULT_BRUSH });
  const setTool = (next: DrawTool) => {
    brush.current = { ...brush.current, tool: next };
    setToolState(next);
  };
  const setColor = (next: string) => {
    brush.current = { ...brush.current, color: next };
    setColorState(next);
  };
  const setSize = (next: number) => {
    brush.current = { ...brush.current, size: next };
    setSizeState(next);
  };

  const canvasRef = useRef<DrawCanvasHandle>(null);
  const presentRef = useRef(history.present);
  presentRef.current = history.present;
  const dirty = useRef(false);
  const sentFinal = useRef(false);
  const [sending, setSending] = useState(false);

  const judging = game.phase === 'judging';
  const locked = !me || me.finished || judging || sending;

  // Nada de pegar ni soltar imágenes mientras se dibuja. El formato de trazos ya
  // no deja mandarlas, pero así ni siquiera parece que se pudiera.
  useEffect(() => {
    const block = (event: Event) => event.preventDefault();
    document.addEventListener('paste', block, true);
    document.addEventListener('drop', block, true);
    document.addEventListener('dragover', block, true);
    document.body.classList.add('is-drawing');
    return () => {
      document.removeEventListener('paste', block, true);
      document.removeEventListener('drop', block, true);
      document.removeEventListener('dragover', block, true);
      document.body.classList.remove('is-drawing');
    };
  }, []);

  useEffect(() => {
    storage.setDraft(code, game.round, encodeDrawing({ strokes: history.present }));
    dirty.current = true;
  }, [history.present, code, game.round]);

  const addStroke = useCallback(
    (stroke: Stroke): boolean => {
      const next = [...presentRef.current, stroke];
      const drawing = { strokes: next };
      const fits =
        next.length <= DRAW_LIMITS.maxStrokes &&
        stroke.points.length / 2 <= DRAW_LIMITS.maxPointsPerStroke &&
        countPoints(drawing) <= DRAW_LIMITS.maxPoints &&
        encodeDrawing(drawing).length <= DRAW_LIMITS.maxEncodedLength;
      if (!fits) {
        pushToast(t.draw.limitReached, 'error');
        return false;
      }
      presentRef.current = next;
      setHistory((h) => ({ past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [] }));
      return true;
    },
    [pushToast, t],
  );

  const sendFinal = useCallback(async () => {
    if (sentFinal.current || !me) return;
    sentFinal.current = true;
    // El trazo que se está dibujando justo ahora también cuenta: `flush` lo cierra
    // y lo suma a `presentRef` en el acto, sin esperar al próximo render.
    canvasRef.current?.flush();
    setSending(true);
    const result = await submitDrawing(game.round, encodeDrawing({ strokes: presentRef.current }), true);
    setSending(false);
    if (!result.ok && result.error !== 'ALREADY_FINISHED') {
      // Se deja reintentar salvo que ya no haya nada que hacer.
      if (result.error !== 'NOT_DRAWING' && result.error !== 'STALE_ROUND') sentFinal.current = false;
      pushToast(errorMessage(result.error), 'error');
    }
  }, [game.round, me, pushToast]);

  // Borrador cada tanto, si cambió: si se corta la conexión, cuenta lo último que llegó.
  useEffect(() => {
    if (locked) return;
    const timer = setInterval(() => {
      if (!dirty.current || sentFinal.current) return;
      dirty.current = false;
      void submitDrawing(game.round, encodeDrawing({ strokes: presentRef.current }), false);
    }, DRAW_DRAFT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [locked, game.round]);

  // Se acabó el tiempo en este reloj: se manda lo que haya. El servidor espera un
  // margen corto por estos envíos, así que no se pierde el último segundo.
  useEffect(() => {
    if (game.phase === 'judging') {
      void sendFinal();
      return;
    }
    const timer = setTimeout(() => void sendFinal(), Math.max(0, game.endsAt - serverNow()));
    return () => clearTimeout(timer);
  }, [game.phase, game.endsAt, sendFinal]);

  const finishedCount = game.players.filter((player) => player.finished).length;

  return (
    <section className="draw-stage">
      <PromptBanner game={game} />
      <DrawTimer game={game} />

      {!me ? (
        <p className="answer-waiting">{t.draw.joinedLate}</p>
      ) : (
        <>
          <div className="draw-stage__canvas">
            <DrawCanvas
              ref={canvasRef}
              strokes={history.present}
              brush={brush}
              locked={locked}
              label={t.draw.canvas}
              onStroke={addStroke}
            />
            {judging && (
              <div className="draw-stage__overlay" role="status">
                <p className="draw-stage__time-up">{t.draw.timeUp}</p>
                <p className="draw-stage__judging">{t.draw.judging}</p>
              </div>
            )}
          </div>

          <DrawToolbar
            tool={tool}
            color={color}
            size={size}
            canUndo={history.past.length > 0 || history.present.length > 0}
            canRedo={history.future.length > 0}
            disabled={locked}
            onTool={setTool}
            onColor={setColor}
            onSize={setSize}
            onUndo={() =>
              setHistory((h) =>
                h.past.length === 0
                  ? h
                  : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] },
              )
            }
            onRedo={() =>
              setHistory((h) =>
                h.future.length === 0
                  ? h
                  : { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) },
              )
            }
            onClear={() =>
              setHistory((h) =>
                h.present.length === 0 ? h : { past: [...h.past, h.present].slice(-MAX_HISTORY), present: [], future: [] },
              )
            }
          />

          <div className="draw-stage__actions">
            <Button
              variant="green"
              size="lg"
              icon="✓"
              disabled={locked}
              onClick={() => void sendFinal()}
            >
              {me.finished ? t.draw.finished : t.draw.finish}
            </Button>
            <p className="draw-stage__count" aria-live="polite">
              {t.draw.finishedCount(finishedCount, game.players.length)}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

/** Qué hay que dibujar: el nombre del país, o la bandera unos segundos. */
function PromptBanner({ game }: { game: DrawSnapshot }) {
  const t = useT();
  const locale = useLocale();
  const prompt = game.prompt;
  const elapsed = useElapsed(game.phase === 'drawing' ? game.startsAt : 0, prompt?.previewMs ?? 0);
  if (!prompt) return null;

  if (prompt.mode === 'name') {
    return (
      <div className="draw-prompt">
        <p className="draw-prompt__label">{t.draw.drawTheFlagOf}</p>
        <h2 className="draw-prompt__name">{prompt.name?.[locale]}</h2>
      </div>
    );
  }

  // La bandera se tapa sola por el reloj, sin esperar al snapshot del servidor.
  const showing = Boolean(prompt.flagUrl) && elapsed < prompt.previewMs;
  return (
    <div className="draw-prompt">
      <p className="draw-prompt__label">{showing ? t.draw.memorize : t.draw.fromMemory}</p>
      {showing && (
        <img className="draw-prompt__flag" src={prompt.flagUrl!} alt="" draggable={false} />
      )}
    </div>
  );
}

function DrawTimer({ game }: { game: DrawSnapshot }) {
  const progress = useProgress(game.startsAt, game.endsAt);
  const seconds = useSecondsLeft(game.endsAt);
  const t = useT();
  const judging = game.phase === 'judging';
  const remaining = judging ? 0 : 1 - progress;
  const critical = !judging && seconds > 0 && seconds <= 5;
  useCountdownTick(seconds, critical);

  return (
    <div
      className={`time-bar draw-timer ${critical ? 'time-bar--critical' : ''}`}
      role="timer"
      aria-label={t.game.secondsLeft(judging ? 0 : seconds)}
    >
      <div
        className={`time-bar__fill ${remaining < 0.2 ? 'time-bar__fill--urgent' : ''}`}
        style={{ transform: `scaleX(${remaining})` }}
      />
      <span key={critical ? seconds : 'calm'} className="time-bar__seconds">
        {judging ? 0 : seconds}
      </span>
    </div>
  );
}

// ── Revelación ──────────────────────────────────────────────

/** Milisegundos desde un instante del servidor. Solo re-renderiza al cruzar `until`. */
function useElapsed(since: number, until: number): number {
  const [elapsed, setElapsed] = useState(() => (since ? serverNow() - since : 0));
  useEffect(() => {
    if (!since) return;
    setElapsed(serverNow() - since);
    const left = since + until - serverNow();
    if (left <= 0) return;
    const timer = setTimeout(() => setElapsed(serverNow() - since), left + 16);
    return () => clearTimeout(timer);
  }, [since, until]);
  return elapsed;
}

/** Qué parte de la revelación ya se destapó, cronometrada contra el reloj del servidor. */
function useRevealStage(startsAt: number) {
  const [now, setNow] = useState(() => serverNow() - startsAt);
  useEffect(() => {
    const marks = [DRAW_REVEAL_TIMING.flagAtMs, DRAW_REVEAL_TIMING.scoresAtMs, DRAW_REVEAL_TIMING.winnerAtMs];
    const timers = marks
      .map((mark) => startsAt + mark - serverNow())
      .filter((left) => left > 0)
      .map((left) => setTimeout(() => setNow(serverNow() - startsAt), left + 16));
    return () => timers.forEach(clearTimeout);
  }, [startsAt]);
  return {
    flag: now >= DRAW_REVEAL_TIMING.flagAtMs,
    scores: now >= DRAW_REVEAL_TIMING.scoresAtMs,
    winner: now >= DRAW_REVEAL_TIMING.winnerAtMs,
  };
}

function RevealStage({ game }: { game: DrawSnapshot }) {
  const t = useT();
  const locale = useLocale();
  const myId = useAppStore((s) => s.session.playerId);
  const stage = useRevealStage(game.startsAt);
  const reveal = game.reveal;
  if (!reveal) return null;

  const nameOf = new Map(game.players.map((player) => [player.playerId, player.nickname]));
  const winners = reveal.winners.map((id) => nameOf.get(id) ?? '?');
  const [first, second] = reveal.entries;
  // Ganó por tiempo: mismo número a la vista, puestos distintos.
  const wonByTime = Boolean(first && second && first.score === second.score && first.rank !== second.rank);

  return (
    <section className="draw-reveal">
      <h2 className="reveal__name draw-reveal__name">{reveal.flag.name[locale]}</h2>

      <div className="draw-reveal__grid">
        <figure className={`draw-card draw-card--flag ${stage.flag ? 'draw-card--shown' : ''}`}>
          <div className="draw-card__frame draw-card__frame--flag">
            {stage.flag ? (
              <img src={reveal.flag.flagUrl} alt={reveal.flag.name[locale]} draggable={false} />
            ) : (
              <span className="draw-card__mystery" aria-hidden="true">?</span>
            )}
          </div>
          <figcaption className="draw-card__caption">
            <span className="draw-card__name">{t.draw.realFlag}</span>
          </figcaption>
        </figure>

        {reveal.entries.map((entry, index) => (
          <EntryCard
            key={entry.playerId}
            entry={entry}
            // Con muchos jugadores la cascada se aprieta: tiene que terminar antes
            // de que aparezca la bandera real.
            delayMs={
              index *
              Math.min(
                DRAW_REVEAL_TIMING.drawingStaggerMs,
                DRAW_REVEAL_TIMING.drawingStaggerTotalMs / reveal.entries.length,
              )
            }
            nickname={nameOf.get(entry.playerId) ?? '?'}
            isMe={entry.playerId === myId}
            showScore={stage.scores}
            showWinner={stage.winner && reveal.winners.includes(entry.playerId)}
          />
        ))}
      </div>

      <p className={`draw-reveal__lead ${stage.winner ? 'draw-reveal__lead--shown' : ''}`}>
        {winners.length === 0 ? t.draw.noRoundWinner : t.draw.roundWinner(winners.join(t.game.and), winners.length > 1)}
        {wonByTime && <span className="draw-reveal__tie">{t.draw.tieByTime}</span>}
      </p>
      <p className="summary__next">{game.round < game.totalRounds ? t.draw.nextFlag : ''}</p>
    </section>
  );
}

function EntryCard({
  entry,
  delayMs,
  nickname,
  isMe,
  showScore,
  showWinner,
}: {
  entry: DrawEntry;
  delayMs: number;
  nickname: string;
  isMe: boolean;
  showScore: boolean;
  showWinner: boolean;
}) {
  const t = useT();
  return (
    <figure
      className={[
        'draw-card',
        'draw-card--entry',
        isMe ? 'draw-card--me' : '',
        showWinner ? 'draw-card--winner' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ animationDelay: `${Math.round(delayMs)}ms` }}
    >
      <div className="draw-card__frame">
        {entry.drawing ? (
          <DrawingView encoded={entry.drawing} label={nickname} />
        ) : (
          <span className="draw-card__empty">{t.draw.emptyDrawing}</span>
        )}
        {showWinner && <span className="draw-card__trophy" aria-hidden="true">🏆</span>}
      </div>
      <figcaption className="draw-card__caption">
        <span className="draw-card__name">
          {nickname}
          {isMe && <span className="player-row__tag">{t.common.you}</span>}
        </span>
        <span className={`draw-card__score ${showScore ? 'draw-card__score--shown' : ''}`}>
          {showScore ? entry.score : '··'}
          <small>/100</small>
        </span>
      </figcaption>
      {/* El desglose, para quien quiera saber de dónde salió su número. */}
      {showScore && isMe && entry.drawing && (
        <dl className="draw-breakdown">
          {(['colors', 'layout', 'shape', 'elements'] as const).map((key) => (
            <div key={key} className="draw-breakdown__item">
              <dt>{t.draw.breakdown[key]}</dt>
              <dd>
                <span className="draw-breakdown__bar" style={{ transform: `scaleX(${entry.breakdown[key] / 100})` }} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </figure>
  );
}

// ── Resultados ──────────────────────────────────────────────

function DrawResults({ game }: { game: DrawSnapshot }) {
  const t = useT();
  const myId = useAppStore((s) => s.session.playerId);
  const isHost = useAppStore(selectIsHost);
  const pushToast = useAppStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  const ranking = [...game.players].sort(byStanding);
  const top = ranking[0]?.points ?? 0;
  const winners = ranking.filter((player) => player.points === top && top > 0);
  const myIndex = ranking.findIndex((player) => player.playerId === myId);
  const me = ranking[myIndex];
  const best = ranking.reduce<DrawPlayer | null>((acc, p) => (!acc || p.bestScore > acc.bestScore ? p : acc), null);
  const average = (player: DrawPlayer) =>
    player.roundsPlayed === 0 ? 0 : Math.round(player.totalScore / player.roundsPlayed);

  async function handleRematch() {
    setBusy(true);
    const result = await rematch();
    setBusy(false);
    if (!result.ok) pushToast(errorMessage(result.error), 'error');
  }

  return (
    <section className="card summary summary--final draw-results">
      <p className="summary__crown" aria-hidden="true">🎨</p>
      <h2 className="summary__title">
        {winners.length === 0
          ? t.draw.noWinner
          : winners.length === 1
            ? t.draw.winner(winners[0]!.nickname)
            : t.draw.tie(winners.map((p) => p.nickname).join(t.game.and))}
      </h2>

      <div className="ranking-block">
        <div className="ranking__head">
          <span className="ranking__head-name">{t.game.table.player}</span>
          <span className="ranking__head-col" title={t.draw.pointsTitle}>{t.draw.pointsColumn}</span>
          <span className="ranking__head-col" title={t.draw.averageTitle}>{t.draw.averageColumn}</span>
        </div>
        <ol className="ranking">
          {ranking.map((player, position) => (
            <li key={player.playerId} className={`ranking__row ${player.playerId === myId ? 'ranking__row--me' : ''}`}>
              <span className="ranking__position">{position + 1}</span>
              <PlayerAvatar className="ranking__avatar" playerId={player.playerId} nickname={player.nickname} />
              <span className="ranking__name">{player.nickname}</span>
              <span className="ranking__score" title={t.draw.pointsTitle}>{player.points}</span>
              <span className="ranking__points" title={t.draw.averageTitle}>{average(player)}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="summary__rule">{t.draw.winnerRule}</p>
      {best && best.bestScore > 0 && (
        <p className="stats__highlight draw-results__best">
          <span aria-hidden="true">✨</span> {t.draw.bestDrawing(best.nickname, best.bestScore)}
        </p>
      )}

      <details className="scoring">
        <summary className="scoring__summary">{t.draw.scoring.title}</summary>
        <ul className="scoring__list">
          <li>{t.draw.scoring.intro}</li>
          <li>{t.draw.scoring.colors}</li>
          <li>{t.draw.scoring.layout}</li>
          <li>{t.draw.scoring.shape}</li>
          <li>{t.draw.scoring.elements}</li>
          <li>{t.draw.scoring.style}</li>
          <li>{t.draw.scoring.ties}</li>
        </ul>
      </details>

      <AdSlot placement="results" />

      <div className="summary__actions">
        <Button variant="ghost" onClick={() => void leaveParty()} disabled={busy}>
          {t.common.leave}
        </Button>
        <ShareResult facts={{ game: 'draw', position: me ? myIndex + 1 : null, players: ranking.length, points: me?.points ?? 0 }} />
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
