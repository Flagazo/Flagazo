import { DEFAULT_VISIBILITY, isPartyVisibility, parseSettingsPatch } from '@flagazo/shared';
import type {
  AnswerFeedback,
  GameError,
  GameSettings,
  PartyError,
  PartyVisibility,
  PublicParty,
  Result,
  RoomState,
} from '@flagazo/shared';
import type { RoomManager } from '../rooms/RoomManager';
import type { GameServer, GameSocket } from '../types';
import type { Session } from './SessionStore';
import type { SessionStore } from './SessionStore';
import { joinChannel } from './partyChannel';
import { safeHandler } from './safeHandler';

type PartyAck<T> = Result<
  T,
  PartyError | GameError | 'BAD_REQUEST' | 'NO_NICKNAME' | 'SERVER_ERROR'
>;

/**
 * Handlers de party. Todos siguen la misma forma:
 * validar quién sos → delegar en RoomManager → responder lo que dijo.
 *
 * Ninguno decide nada por su cuenta: las reglas (host, cupo, expulsados)
 * viven en RoomManager, que es también lo que testeamos.
 */
export function registerPartyHandlers(
  io: GameServer,
  socket: GameSocket,
  session: Session,
  sessions: SessionStore,
  rooms: RoomManager,
) {
  /** Un jugador sin nickname no puede tocar parties: no tendría nombre para mostrar. */
  function actor(): { id: string; nickname: string } | null {
    return session.nickname ? { id: session.playerId, nickname: session.nickname } : null;
  }

  socket.on(
    'party:create',
    safeHandler<{ visibility?: unknown }, PartyAck<{ room: RoomState }>>(
      'party:create',
      (payload, ack) => {
        const player = actor();
        if (!player) return ack({ ok: false, error: 'NO_NICKNAME' });

        // No decir nada es válido y significa privada; decir cualquier otra cosa, no.
        if (payload.visibility !== undefined && !isPartyVisibility(payload.visibility)) {
          return ack({ ok: false, error: 'BAD_REQUEST' });
        }

        const result = rooms.create(player, payload.visibility ?? DEFAULT_VISIBILITY);
        if (!result.ok) return ack(result);

        joinChannel(io, sessions, player.id, result.data);
        ack({ ok: true, data: { room: result.data.toState() } });
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'party:join',
    safeHandler<{ code?: unknown }, PartyAck<{ room: RoomState }>>(
      'party:join',
      (payload, ack) => {
        const player = actor();
        if (!player) return ack({ ok: false, error: 'NO_NICKNAME' });

        const result = rooms.join(payload.code, player);
        if (!result.ok) return ack(result);

        joinChannel(io, sessions, player.id, result.data);
        ack({ ok: true, data: { room: result.data.toState() } });
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'party:leave',
    safeHandler<Record<string, never>, PartyAck<null>>(
      'party:leave',
      (_payload, ack) => {
        // El aviso "room:left" y la baja del canal los dispara el hook onPlayerRemoved.
        ack(rooms.leave(session.playerId));
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'party:kick',
    safeHandler<{ playerId?: unknown }, PartyAck<null>>(
      'party:kick',
      (payload, ack) => {
        ack(rooms.kick(session.playerId, payload.playerId));
      },
      (error) => ({ ok: false, error }),
    ),
  );

  // ── Partida ───────────────────────────────────────────────

  socket.on(
    'game:start',
    safeHandler<Record<string, never>, PartyAck<null>>(
      'game:start',
      (_payload, ack) => {
        ack(rooms.startGame(session.playerId));
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'game:answer',
    safeHandler<{ text?: unknown }, PartyAck<AnswerFeedback>>(
      'game:answer',
      (payload, ack) => {
        if (typeof payload.text !== 'string') return ack({ ok: false, error: 'BAD_REQUEST' });

        const result = rooms.answer(session.playerId, payload.text);
        if (!result.ok) return ack(result);
        // Solo quien respondió sabe si acertó; los demás ven que respondió y nada más.
        ack({ ok: true, data: { verdict: result.data.verdict, options: result.data.options } });
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'draw:submit',
    safeHandler<{ round?: unknown; drawing?: unknown; final?: unknown }, PartyAck<null>>(
      'draw:submit',
      (payload, ack) => {
        // Solo la forma del payload: el contenido del dibujo lo valida el motor,
        // con el mismo decodificador que usa el cliente para armarlo.
        if (typeof payload.round !== 'number' || typeof payload.drawing !== 'string') {
          return ack({ ok: false, error: 'BAD_REQUEST' });
        }
        ack(rooms.submitDrawing(session.playerId, payload));
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'game:rematch',
    safeHandler<Record<string, never>, PartyAck<null>>(
      'game:rematch',
      (_payload, ack) => {
        ack(rooms.rematch(session.playerId));
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'party:updateSettings',
    safeHandler<{ settings?: unknown }, PartyAck<{ settings: GameSettings }>>(
      'party:updateSettings',
      (payload, ack) => {
        const patch = parseSettingsPatch(payload.settings);
        if (!patch) return ack({ ok: false, error: 'BAD_REQUEST' });

        const result = rooms.updateSettings(session.playerId, patch);
        if (!result.ok) return ack(result);
        ack({ ok: true, data: { settings: result.data } });
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'party:setVisibility',
    safeHandler<{ visibility?: unknown }, PartyAck<{ visibility: PartyVisibility }>>(
      'party:setVisibility',
      (payload, ack) => {
        if (!isPartyVisibility(payload.visibility)) {
          return ack({ ok: false, error: 'BAD_REQUEST' });
        }

        const result = rooms.setVisibility(session.playerId, payload.visibility);
        if (!result.ok) return ack(result);
        ack({ ok: true, data: { visibility: result.data } });
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'party:list',
    safeHandler<Record<string, never>, PartyAck<{ parties: PublicParty[] }>>(
      'party:list',
      (_payload, ack) => {
        // No pide nickname: mirar qué hay se puede hacer antes de decidir nada.
        ack({ ok: true, data: { parties: rooms.listPublic() } });
      },
      (error) => ({ ok: false, error }),
    ),
  );
}
