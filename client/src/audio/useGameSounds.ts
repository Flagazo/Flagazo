import { useEffect, useRef } from 'react';
import type { GameSnapshot } from '@flagazo/shared';
import { useAppStore } from '../store/useAppStore';
import { sound } from './SoundManager';

/**
 * Traduce los cambios de la partida en sonidos.
 *
 * Está todo en un solo lugar a propósito: los sonidos se disparan al **detectar
 * transiciones** del snapshot, no desde los componentes que dibujan. Así no hay
 * que acordarse de agregar un `play()` en cada lugar donde se pinta algo, y no
 * suena dos veces cuando React vuelve a renderizar lo mismo.
 */
export function useGameSounds(game: GameSnapshot | null) {
  const myId = useAppStore((s) => s.session.playerId);

  // Lo que se vio la última vez, para saber qué cambió.
  const previous = useRef({ phase: '', flagKey: '', seconds: -1, streak: 0 });

  useEffect(() => {
    if (!game) {
      previous.current = { phase: '', flagKey: '', seconds: -1, streak: 0 };
      return;
    }

    const flagKey = `${game.round}-${game.flagInRound}`;
    const me = game.players.find((player) => player.playerId === myId);
    const before = previous.current;

    if (game.phase !== before.phase || flagKey !== before.flagKey) {
      switch (game.phase) {
        case 'flag':
          sound.play('go');
          break;
        case 'reveal': {
          // Suena lo que le pasó a quien está mirando, no un resultado genérico.
          const mine = game.outcomes.find((outcome) => outcome.playerId === myId);
          if (!mine) sound.play('reveal');
          else if (mine.correct) sound.play(mine.typos > 0 ? 'close' : 'correct');
          else sound.play('wrong');
          break;
        }
        case 'roundSummary':
          sound.play('roundEnd');
          break;
        case 'results':
          sound.play('gameEnd');
          break;
      }
    }

    // La racha suena solo cuando cruza un escalón del multiplicador.
    const streak = me?.streak ?? 0;
    if (streak > before.streak && (streak === 3 || streak === 5 || streak === 10)) {
      sound.play('streak');
    }

    previous.current = { phase: game.phase, flagKey, seconds: before.seconds, streak };
  }, [game, myId]);
}

/**
 * El tic-tac de la cuenta regresiva.
 *
 * Va aparte porque depende del reloj sincronizado y no del snapshot: los
 * segundos cambian entre renders sin que llegue nada del servidor.
 */
export function useCountdownTick(seconds: number, active: boolean) {
  const lastPlayed = useRef(-1);

  useEffect(() => {
    if (!active) {
      lastPlayed.current = -1;
      return;
    }
    if (seconds <= 0 || seconds === lastPlayed.current) return;
    lastPlayed.current = seconds;
    sound.play('tick');
  }, [seconds, active]);
}
