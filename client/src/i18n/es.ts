import {
  MAX_FLAGS_PER_GAME,
  MAX_PLAYERS_PER_PARTY,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  PARTY_CODE_LENGTH,
} from '@flagazo/shared';
import type { Dictionary } from './types';

/**
 * Diccionario en español neutro.
 *
 * Neutro quiere decir tuteo y sin regionalismos: "escribe" y no "escribí",
 * "tú" y no "vos", "sala" y no "party". La idea es que se lea igual de natural
 * en México, en España o en Argentina, aunque en ninguna suene exactamente
 * como se habla en la calle.
 */
export const es: Dictionary = {
  common: {
    leave: 'Salir',
    you: 'tú',
    host: 'Anfitrión',
    disconnected: 'desconectado',
    round: 'ronda',
    rounds: 'rondas',
    points: 'pts',
    waitingForHost: 'Esperando al anfitrión…',
  },

  topbar: {
    home: 'Volver al menú principal',
    language: 'Idioma',
    unmute: 'Activar sonido',
    mute: 'Silenciar',
    connection: {
      connecting: 'Conectando…',
      connected: 'En línea',
      reconnecting: 'Reconectando…',
      offline: 'Sin conexión',
    },
    playersOnline: 'Jugadores conectados',
    latency: 'Latencia con el servidor',
  },

  nickname: {
    tagline: '¿Cuántas banderas reconoces antes que tus amigos?',
    label: 'Elige tu nickname',
    placeholder: (name) => `Ej: ${name}`,
    help: 'Letras, números, espacios y _ . -',
    connecting: 'Conectando…',
    entering: 'Entrando…',
    play: 'Jugar',
  },

  menu: {
    playingAs: 'Jugando como',
    change: 'Cambiar',
    createTitle: 'Crear sala',
    createText: 'Arma una sala privada y pasa el código a tus amigos.',
    create: 'Crear sala',
    joinTitle: 'Entrar con código',
    join: 'Entrar',
    codeLabel: 'Código de la sala',
    codeLength: `El código tiene ${PARTY_CODE_LENGTH} caracteres`,
    visibility: 'Quién la puede encontrar',
    private: 'Privada',
    public: 'Pública',
    privateHint: 'Solo entra quien tenga el código.',
    publicHint: 'Cualquiera la encuentra en la lista de salas.',
    browseTitle: 'Salas públicas',
    browseText: 'Métete en una sala que está esperando jugadores.',
    browse: 'Ver salas',
  },

  donate: {
    title: (game) => `¿Te gusta ${game}?`,
    text: 'Es gratis y no pide cuenta. Si quieres, puedes colaborar.',
    action: 'Donar',
  },

  browse: {
    title: 'Salas públicas',
    subtitle: 'Salas esperando jugadores. Elige una y entra.',
    refresh: 'Actualizar',
    back: 'Volver',
    loading: 'Buscando salas…',
    empty: 'No hay salas públicas en este momento.',
    emptyHint: 'Crea una y hazla pública: aparece acá para todo el mundo.',
    createOne: 'Crear una sala',
    hostedBy: (nickname) => `Anfitrión: ${nickname}`,
    slots: (players, max) => `${players}/${max} jugadores`,
    setup: (rounds, flags, seconds) =>
      `${rounds === 1 ? '1 ronda' : `${rounds} rondas`} · ${flags} banderas · ${seconds}s cada una`,
    drawSetup: (rounds, seconds) => `${rounds} banderas para dibujar · ${seconds}s cada una`,
    justCreated: 'recién',
    minutesAgo: (minutes) => `hace ${minutes} min`,
    join: 'Entrar',
  },

  lobby: {
    codeLabel: 'Código de la sala',
    copyCode: 'Copiar el código',
    codeHidden: 'Código oculto',
    showCode: 'Mostrar el código',
    hideCode: 'Ocultar el código',
    hintHidden: 'Oculto para compartir pantalla. Si lo tocas, se copia igual.',
    hintVisible: 'Pásalo a tus amigos para que entren.',
    codeCopied: 'Código copiado 📋',
    copyFailed: 'No se pudo copiar. Díctalo a mano.',

    players: 'Jugadores',
    kick: (nickname) => `Expulsar a ${nickname}`,
    kicked: (nickname) => `${nickname} fue expulsado`,

    settings: 'Configuración',
    hostDecides: 'Decide el anfitrión',
    game: 'Modo de juego',
    mode: 'Variante',
    drawRounds: 'Rondas',
    drawRoundsHint: 'una bandera cada una',
    drawSeconds: 'Tiempo para dibujar',
    drawPrompt: 'Qué te toca',
    drawPrompts: {
      name: 'Nombre del país',
      flag: (seconds) => `La bandera, ${seconds}s`,
    },
    drawPromptHints: {
      name: 'Lees el nombre y dibujas la bandera de memoria.',
      flag: (seconds) => `La bandera se ve ${seconds} segundos y se tapa. Después, de memoria.`,
    },
    drawSummary: (rounds, minutes) => `${rounds} banderas para dibujar · ~${minutes} min`,
    difficulty: 'Dificultad',
    difficulties: {
      easy: 'Fácil',
      medium: 'Medio',
      hard: 'Difícil',
      all: 'Todas',
    },
    roundsLabel: 'Rondas',
    roundsHint: '1 punto cada una',
    roundsTooMany: (rounds, flags) =>
      `${rounds} rondas × ${flags} banderas pasa el máximo de ${MAX_FLAGS_PER_GAME}`,
    flagsPerRound: 'Banderas por ronda',
    secondsPerFlag: 'Tiempo por bandera',
    summary: (rounds, flags, total, minutes) =>
      `${rounds === 1 ? 'Ronda única' : `${rounds} rondas`} de ${flags} banderas · ` +
      `${total} en total · ~${minutes} min`,
    start: 'Empezar',
    minus: (step) => `Restar ${step}`,
    plus: (step) => `Sumar ${step}`,

    visibility: 'Visibilidad',
    private: 'Privada',
    public: 'Pública',
    privateBadge: '🔒 Privada',
    publicBadge: '🌐 Pública',
    privateHint: 'Solo entra quien tenga el código.',
    publicHint: 'Listada para que cualquiera la encuentre mientras estén en el lobby.',
  },

  kinds: {
    guess: {
      name: 'Flag Guess',
      description: 'Aparece una bandera y todos compiten por nombrarla primero.',
    },
    draw: {
      name: 'Draw Battle',
      description:
        'A todos les toca el mismo país y dibujan su bandera de memoria. Gana el mejor dibujo.',
    },
  },

  modes: {
    normal: { name: 'Normal', description: 'La bandera tal cual, sin vueltas.' },
    pixelated: {
      name: 'Pixelada',
      description: 'Empieza hecha bloques y se va aclarando. El que arriesga antes, gana más.',
    },
    cropped: {
      name: 'Recortada',
      description: 'Se ve un pedacito muy de cerca y la cámara se va alejando.',
    },
    grayscale: {
      name: 'Sin color',
      description: 'Todo en grises. Sin los colores hay que fijarse en las formas.',
    },
    similar: {
      name: 'Parecidas',
      description: 'Solo banderas que se confunden entre sí, y aparecen de a pares.',
    },
    bomb: {
      name: 'Bomba',
      description: 'La mecha se acorta con cada bandera. Si explota sin tu respuesta, duele.',
    },
    flash: {
      name: 'Parpadeo',
      description: 'Aparece un instante y se tapa. Si parpadeas, te la perdiste.',
    },
  },

  game: {
    flagOf: (flag, total) => `Bandera ${flag} de ${total}`,
    roundAndFlag: (round, rounds, flag, flags) =>
      `Ronda ${round}/${rounds} · bandera ${flag}/${flags}`,
    final: 'Final',

    standings: 'Tabla de posiciones',
    standingsTitle: 'Posiciones',
    roundsWon: 'Rondas ganadas',
    streakTitle: (streak, multiplier) => `${streak} seguidas · ×${multiplier}`,
    playingNext: 'Juegan la próxima',

    letsGo: '¡Empezamos!',
    roundNumber: (round) => `Ronda ${round}`,
    now: '¡Ya!',

    flagAlt: 'Bandera',
    guessAlt: 'Bandera a adivinar',
    secondsLeft: (seconds) => `${seconds} segundos`,

    joinedLate: 'Entraste con la partida empezada: juegas la próxima 👀',
    answerSent: 'Respuesta enviada',
    answerPlaceholder: '¿Qué país es?',
    yourAnswer: 'Tu respuesta',
    send: 'Enviar',
    feedback: {
      correct: '✅ ¡Muy bien!',
      close: '✅ ¡Casi! Te la damos, con menos puntos',
      wrong: '❌ No era esa',
      ambiguous: (options) => `🟡 Sé más específico: ¿${options}?`,
      or: ' o ',
    },

    noAnswer: 'sin responder',
    typosForgiven: 'Con errores de tipeo perdonados',
    streakOf: (streak) => `${streak} seguidas`,

    roundOver: (round) => `Fin de la ronda ${round}`,
    noRoundWinner: 'Ronda sin ganador: nadie sumó puntos',
    roundWinner: (names, many, points) =>
      `${names} ${many ? 'ganan' : 'gana'} la ronda con ${points} pts`,
    nextRound: (round) => `Ronda ${round} en unos segundos…`,
    and: ' y ',

    noWinner: 'Nadie se llevó una ronda',
    winner: (nickname) => `¡Ganó ${nickname}!`,
    tie: (names) => `Empate: ${names}`,
    rematch: 'Revancha',

    statsTitle: 'Cómo les fue',
    fastest: 'Más rápido',
    fastestIn: (nickname, time) => `Más rápido: ${nickname} en ${time}`,
    bestStreak: (nickname, streak) => `Mejor racha: ${nickname} con ${streak} seguidas`,
    table: {
      player: 'Jugador',
      correct: 'Banderas acertadas',
      wrong: 'Respondidas mal',
      missed: 'Sin responder',
      streak: 'Mejor racha',
      fastest: 'Su respuesta más rápida',
      average: 'Tiempo promedio de sus aciertos',
      points: 'Puntos de toda la partida',
      correctShort: 'Aciertos',
      wrongShort: 'Errores',
      missedShort: 'Pasadas',
      streakShort: 'Racha',
      fastestShort: 'Mejor',
      averageShort: 'Prom.',
      pointsShort: 'Puntos',
    },

    roundsWonColumn: 'Rondas',
    pointsThisRound: 'Puntos de la ronda',
    pointsTotal: 'Puntos totales',
    winnerRule: 'La partida la ganan las rondas. Los puntos solo deciden quién se lleva cada ronda.',

    scoring: {
      title: 'Cómo se suman los puntos',
      correct: (base, bonus) =>
        `Acertar da ${base} pts, más hasta ${bonus} extra según lo rápido que respondas.`,
      typos: (one, more) =>
        `Si se te perdona un error de tipeo, queda el ${one}%; con dos o más, el ${more}%.`,
      streak: (tiers) => `Los aciertos seguidos multiplican todo: ${tiers}.`,
      wrong: (penalty) => `Errar te cuesta ${penalty} pts, pero la ronda nunca baja de 0.`,
      missed: (penalty) =>
        `En el modo Bomba, dejar que se acabe el tiempo también cuesta ${penalty} pts.`,
      rounds:
        'Quien más puntos hace en una ronda se la lleva, y cada ronda ganada es 1 punto en el marcador de arriba.',
    },
  },

  draw: {
    roundOf: (round, total) => `Ronda ${round}/${total}`,
    drawTheFlagOf: 'Dibuja la bandera de',
    memorize: '¡Memorízala!',
    fromMemory: 'Ahora, de memoria ✍️',
    canvas: 'Lienzo de dibujo',
    finish: 'Terminar',
    finished: 'Listo ✓',
    finishedCount: (done, total) => `${done} de ${total} terminaron`,
    timeUp: '⏰ ¡Tiempo!',
    judging: 'Comparando los dibujos…',
    joinedLate: 'Entraste con la partida empezada: dibujas en la próxima 👀',
    limitReached: 'El dibujo está lleno. Deshaz algo para seguir.',

    tools: {
      label: 'Herramientas de dibujo',
      brush: 'Pincel',
      eraser: 'Borrador',
      undo: 'Deshacer',
      redo: 'Rehacer',
      clear: 'Borrar todo',
      size: 'Grosor del pincel',
      sizes: { thin: 'Fino', medium: 'Medio', thick: 'Grueso' },
      colors: 'Colores',
      custom: 'Elegir cualquier color',
    },
    colors: {
      red: 'Rojo',
      maroon: 'Granate',
      orange: 'Naranja',
      yellow: 'Amarillo',
      green: 'Verde',
      darkGreen: 'Verde oscuro',
      lightBlue: 'Celeste',
      blue: 'Azul',
      navy: 'Azul marino',
      purple: 'Violeta',
      pink: 'Rosa',
      brown: 'Marrón',
      white: 'Blanco',
      gray: 'Gris',
      black: 'Negro',
    },

    realFlag: 'La bandera real',
    emptyDrawing: 'No dibujó',
    finishedIn: (seconds) => `terminó en ${seconds}`,
    roundWinner: (names, many) => `🏆 ${names} ${many ? 'se llevan' : 'se lleva'} la ronda`,
    noRoundWinner: 'Nadie dibujó nada: esta ronda no tiene ganador',
    tieByTime: 'Mismo puntaje: se la lleva quien terminó primero',
    nextFlag: 'Siguiente bandera en unos segundos…',
    breakdown: {
      colors: 'Colores',
      layout: 'Ubicación',
      shape: 'Forma',
      elements: 'Elementos',
    },

    standings: 'Draw Battle',
    pointsColumn: 'Pts',
    pointsTitle: 'Puntos en el marcador',
    averageColumn: 'Prom',
    averageTitle: 'Puntaje promedio de sus dibujos',
    bestDrawing: (nickname, score) => `Mejor dibujo: ${nickname} con ${score}/100`,
    winner: (nickname) => `¡${nickname} gana Draw Battle!`,
    tie: (names) => `Empate: ${names}`,
    noWinner: 'Nadie ganó ninguna ronda',
    winnerRule: 'El mejor dibujo de cada ronda se lleva 1 punto. Gana quien sume más.',

    scoring: {
      title: 'Cómo se puntúan los dibujos',
      intro: 'El servidor compara cada dibujo con la bandera real, igual para todos.',
      colors: 'Colores: ¿usaste los de la bandera, en cantidad parecida?',
      layout: 'Ubicación: ¿están en el lugar correcto?',
      shape: 'Forma: ¿el dibujo ocupa el lienzo como la bandera?',
      elements:
        'Elementos: ¿incluiste lo que la hace esa bandera (el disco, la hoja, la cruz)? Olvidarlo cuesta mucho.',
      style: 'Las líneas temblorosas, rellenar a garabatos y saltear detalles diminutos casi no cuestan.',
      ties: 'Con el mismo puntaje, se lleva la ronda quien apretó Terminar primero.',
    },
  },

  toasts: {
    joined: (nickname) => `${nickname} se unió 👋`,
    left: (nickname) => `${nickname} se fue`,
    youAreHost: '👑 Ahora eres el anfitrión',
    isHost: (nickname) => `👑 ${nickname} es el anfitrión`,
    kickedYou: 'Te expulsaron de la sala 👋',
    partyClosed: 'La sala se cerró',
    inactive: 'Te sacaron de la sala por inactividad',
  },

  errors: {
    EMPTY: 'Escribe un nickname.',
    TOO_SHORT: `Mínimo ${NICKNAME_MIN_LENGTH} caracteres.`,
    TOO_LONG: `Máximo ${NICKNAME_MAX_LENGTH} caracteres.`,
    INVALID_CHARS: 'Solo letras, números, espacios y _ . -',
    NEEDS_ALPHANUMERIC: 'Tiene que tener al menos una letra o número.',
    TAKEN: 'Ese nickname ya está en uso en esta sala.',

    INVALID_CODE: `El código tiene ${PARTY_CODE_LENGTH} caracteres.`,
    NOT_FOUND: 'No existe ninguna sala con ese código.',
    FULL: `La sala está llena (máximo ${MAX_PLAYERS_PER_PARTY}).`,
    NICK_TAKEN: 'Ya hay alguien con tu nickname en esa sala.',
    KICKED: 'Te expulsaron de esa sala.',
    ALREADY_IN_PARTY: 'Ya estás en otra sala.',
    NOT_IN_PARTY: 'Ya no estás en la sala.',
    NOT_HOST: 'Solo el anfitrión puede hacer eso.',
    TARGET_NOT_FOUND: 'Ese jugador ya no está en la sala.',
    CANT_KICK_HOST: 'No puedes expulsarte a ti mismo.',
    INVALID_SETTINGS: `Esa combinación pasa el máximo de ${MAX_FLAGS_PER_GAME} banderas.`,
    NO_CODE_AVAILABLE: 'No se pudo generar un código. Inténtalo de nuevo.',

    ALREADY_PLAYING: 'La partida ya empezó.',
    NOT_PLAYING: 'No hay ninguna partida en curso.',
    NO_FLAG_ACTIVE: 'Justo terminó el tiempo de esa bandera.',
    ALREADY_ANSWERED: 'Ya respondiste esta bandera.',
    NOT_ENOUGH_FLAGS: 'No hay banderas suficientes para esa configuración.',
    GAME_NOT_FINISHED: 'La partida todavía no terminó.',
    WRONG_GAME: 'Eso es de otro modo de juego.',
    NOT_DRAWING: 'Se terminó el tiempo de este dibujo.',
    ALREADY_FINISHED: 'Ya terminaste este dibujo.',
    STALE_ROUND: 'Ese dibujo era de una ronda que ya terminó.',
    INVALID_DRAWING: 'No se pudo mandar el dibujo. Vuelve a intentarlo.',

    BAD_REQUEST: 'Pedido inválido.',
    NO_NICKNAME: 'Primero elige un nickname.',
    SERVER_ERROR: 'Algo falló en el servidor. Inténtalo de nuevo.',
    TIMEOUT: 'El servidor no respondió. Revisa tu conexión.',
    UNKNOWN: 'Error inesperado.',
  },
};
