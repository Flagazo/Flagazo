import {
  MAX_FLAGS_PER_GAME,
  MAX_PLAYERS_PER_PARTY,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  PARTY_CODE_LENGTH,
} from '@flagazo/shared';

/**
 * Diccionario en inglés. Es el idioma por defecto y también el molde: el tipo
 * `Dictionary` sale de acá, así que agregar una clave sin traducirla al español
 * rompe el typecheck en vez de aparecer vacía en pantalla.
 *
 * Los valores que dependen de algo (un nombre, un número) son funciones. Así el
 * orden de las palabras es libre en cada idioma, en vez de tener que armar la
 * frase pegando pedazos afuera.
 */
export const en = {
  common: {
    leave: 'Leave',
    you: 'you',
    host: 'Host',
    disconnected: 'disconnected',
    round: 'round',
    rounds: 'rounds',
    points: 'pts',
    waitingForHost: 'Waiting for the host…',
  },

  topbar: {
    /** El logo lleva al menú: la etiqueta dice a dónde, no qué es. */
    home: 'Back to the main menu',
    language: 'Language',
    unmute: 'Turn sound on',
    mute: 'Mute',
    connection: {
      connecting: 'Connecting…',
      connected: 'Online',
      reconnecting: 'Reconnecting…',
      offline: 'Offline',
    },
    playersOnline: 'Players online',
    latency: 'Latency to the server',
  },

  nickname: {
    tagline: 'How many flags can you name before your friends do?',
    label: 'Pick your nickname',
    /* El nombre lo elige `lib/exampleName.ts`, distinto en cada carga. */
    placeholder: (name: string) => `e.g. ${name}`,
    help: 'Letters, numbers, spaces and _ . -',
    connecting: 'Connecting…',
    entering: 'Entering…',
    play: 'Play',
  },

  menu: {
    playingAs: 'Playing as',
    change: 'Change',
    createTitle: 'Create a party',
    createText: 'Set up a private room and share the code with your friends.',
    create: 'Create party',
    joinTitle: 'Join with a code',
    join: 'Enter',
    codeLabel: 'Party code',
    codeLength: `The code is ${PARTY_CODE_LENGTH} characters long`,
    visibility: 'Who can find it',
    private: 'Private',
    public: 'Public',
    privateHint: 'Only people with the code get in.',
    publicHint: 'Anyone can find it in the lobby list.',
    browseTitle: 'Public lobbies',
    browseText: 'Jump into a party that is waiting for players.',
    browse: 'Browse lobbies',
  },

  donate: {
    title: (game: string) => `Enjoying ${game}?`,
    text: 'It is free and needs no account. You can chip in if you want.',
    action: 'Donate',
  },

  browse: {
    title: 'Public lobbies',
    subtitle: 'Parties waiting for players. Pick one and jump in.',
    refresh: 'Refresh',
    back: 'Back',
    loading: 'Looking for parties…',
    empty: 'No public parties right now.',
    emptyHint: 'Create one and make it public — it shows up here for everyone.',
    createOne: 'Create a party',
    hostedBy: (nickname: string) => `Hosted by ${nickname}`,
    slots: (players: number, max: number) => `${players}/${max} players`,
    setup: (rounds: number, flags: number, seconds: number) =>
      `${rounds === 1 ? '1 round' : `${rounds} rounds`} · ${flags} flags · ${seconds}s each`,
    justCreated: 'just now',
    minutesAgo: (minutes: number) => `${minutes} min ago`,
    join: 'Join',
  },

  lobby: {
    codeLabel: 'Party code',
    copyCode: 'Copy the code',
    codeHidden: 'Code hidden',
    showCode: 'Show the code',
    hideCode: 'Hide the code',
    hintHidden: 'Hidden for screen sharing. Tap it and it still copies.',
    hintVisible: 'Share it with your friends so they can join.',
    codeCopied: 'Code copied 📋',
    copyFailed: 'Could not copy. Read it out loud instead.',

    players: 'Players',
    kick: (nickname: string) => `Kick ${nickname}`,
    kicked: (nickname: string) => `${nickname} was kicked`,

    settings: 'Settings',
    hostDecides: 'The host decides',
    mode: 'Mode',
    difficulty: 'Difficulty',
    difficulties: {
      easy: 'Easy',
      medium: 'Medium',
      hard: 'Hard',
      all: 'All',
    },
    roundsLabel: 'Rounds',
    roundsHint: '1 point each',
    roundsTooMany: (rounds: number, flags: number) =>
      `${rounds} rounds × ${flags} flags goes over the ${MAX_FLAGS_PER_GAME} flag limit`,
    flagsPerRound: 'Flags per round',
    secondsPerFlag: 'Time per flag',
    summary: (rounds: number, flags: number, total: number, minutes: number) =>
      `${rounds === 1 ? 'Single round' : `${rounds} rounds`} of ${flags} flags · ` +
      `${total} in total · ~${minutes} min`,
    start: 'Start',
    minus: (step: number) => `Subtract ${step}`,
    plus: (step: number) => `Add ${step}`,

    visibility: 'Visibility',
    private: 'Private',
    public: 'Public',
    privateBadge: '🔒 Private',
    publicBadge: '🌐 Public',
    privateHint: 'Only people with the code get in.',
    publicHint: 'Listed for anyone to find while you are in the lobby.',
  },

  modes: {
    normal: { name: 'Normal', description: 'The flag as it is, no twists.' },
    pixelated: {
      name: 'Pixelated',
      description: 'It starts as blocks and clears up. Guessing early pays more.',
    },
    cropped: {
      name: 'Cropped',
      description: 'You see a tiny piece up close and the camera pulls back.',
    },
    grayscale: {
      name: 'No color',
      description: 'All grays. Without the colors you have to read the shapes.',
    },
    similar: {
      name: 'Lookalikes',
      description: 'Only flags that get mixed up, and they come in pairs.',
    },
    bomb: {
      name: 'Bomb',
      description: 'The fuse gets shorter every flag. If it blows without your answer, it hurts.',
    },
    /*
     * Sin el número de milisegundos a propósito: si algún día se recalibra
     * `FLASH_VISIBLE_MS`, un texto que dijera "medio segundo" quedaría mintiendo.
     */
    flash: {
      name: 'Blink',
      description: 'It shows for an instant and then it is gone. Blink and you miss it.',
    },
  },

  game: {
    flagOf: (flag: number, total: number) => `Flag ${flag} of ${total}`,
    roundAndFlag: (round: number, rounds: number, flag: number, flags: number) =>
      `Round ${round}/${rounds} · flag ${flag}/${flags}`,
    final: 'Final',

    standings: 'Standings',
    standingsTitle: 'Standings',
    roundsWon: 'Rounds won',
    streakTitle: (streak: number, multiplier: number) =>
      `${streak} in a row · ×${multiplier}`,
    playingNext: 'Playing next round',

    letsGo: "Let's go!",
    roundNumber: (round: number) => `Round ${round}`,
    now: 'Go!',

    flagAlt: 'Flag',
    guessAlt: 'Flag to guess',
    secondsLeft: (seconds: number) => `${seconds} seconds`,

    joinedLate: 'You joined mid-game: you play the next one 👀',
    answerSent: 'Answer sent',
    answerPlaceholder: 'Which country is it?',
    yourAnswer: 'Your answer',
    send: 'Send',
    feedback: {
      correct: '✅ Nailed it!',
      close: '✅ Close! We will take it, for fewer points',
      wrong: '❌ Not that one',
      ambiguous: (options: string) => `🟡 Be more specific: ${options}?`,
      or: ' or ',
    },

    noAnswer: 'no answer',
    typosForgiven: 'With typos forgiven',
    streakOf: (streak: number) => `${streak} in a row`,

    roundOver: (round: number) => `End of round ${round}`,
    noRoundWinner: 'Nobody scored: the round has no winner',
    roundWinner: (names: string, many: boolean, points: number) =>
      `${names} ${many ? 'win' : 'wins'} the round with ${points} pts`,
    nextRound: (round: number) => `Round ${round} in a few seconds…`,
    and: ' and ',

    noWinner: 'Nobody won a round',
    winner: (nickname: string) => `${nickname} wins!`,
    tie: (names: string) => `Tie: ${names}`,
    rematch: 'Rematch',

    statsTitle: 'How it went',
    fastest: 'Fastest',
    fastestIn: (nickname: string, time: string) => `Fastest: ${nickname} in ${time}`,
    bestStreak: (nickname: string, streak: number) => `Best streak: ${nickname} with ${streak} in a row`,
    table: {
      player: 'Player',
      correct: 'Flags guessed right',
      wrong: 'Answered wrong',
      missed: 'No answer',
      streak: 'Best streak',
      fastest: 'Their fastest answer',
      average: 'Average time of their correct answers',
      points: 'Points for the whole game',
      /*
       * Etiquetas cortas y visibles para el encabezado. Antes solo estaba el
       * emoji con un `title` encima: en un celular no hay con qué hacer hover,
       * así que la columna no se podía saber qué era.
       */
      correctShort: 'Right',
      wrongShort: 'Wrong',
      missedShort: 'Missed',
      streakShort: 'Streak',
      fastestShort: 'Best',
      averageShort: 'Avg',
      pointsShort: 'Points',
    },

    /** Las dos escalas del juego, nombradas donde aparecen. */
    roundsWonColumn: 'Rounds',
    pointsThisRound: 'Round points',
    pointsTotal: 'Total points',
    winnerRule: 'Rounds win the game. Points only decide who takes each round.',

    scoring: {
      title: 'How points work',
      correct: (base: number, bonus: number) =>
        `A right answer is ${base} pts, plus up to ${bonus} more the faster you are.`,
      typos: (one: number, more: number) =>
        `One forgiven typo keeps ${one}% of that; two or more, ${more}%.`,
      streak: (tiers: string) => `Answers in a row multiply everything: ${tiers}.`,
      wrong: (penalty: number) =>
        `A wrong answer costs you ${penalty} pts, but a round never drops below 0.`,
      missed: (penalty: number) =>
        `In Bomb mode, letting the time run out also costs ${penalty} pts.`,
      rounds:
        'Whoever scores most in a round wins it, and each round won is 1 point on the scoreboard above.',
    },
  },

  toasts: {
    joined: (nickname: string) => `${nickname} joined 👋`,
    left: (nickname: string) => `${nickname} left`,
    youAreHost: '👑 You are the host now',
    isHost: (nickname: string) => `👑 ${nickname} is the host now`,
    kickedYou: 'You were kicked from the party 👋',
    partyClosed: 'The party was closed',
    inactive: 'You were removed from the party for being inactive',
  },

  errors: {
    EMPTY: 'Type a nickname.',
    TOO_SHORT: `At least ${NICKNAME_MIN_LENGTH} characters.`,
    TOO_LONG: `At most ${NICKNAME_MAX_LENGTH} characters.`,
    INVALID_CHARS: 'Only letters, numbers, spaces and _ . -',
    NEEDS_ALPHANUMERIC: 'It needs at least one letter or number.',
    TAKEN: 'That nickname is already taken in this party.',

    INVALID_CODE: `The code is ${PARTY_CODE_LENGTH} characters long.`,
    NOT_FOUND: 'There is no party with that code.',
    FULL: `The party is full (${MAX_PLAYERS_PER_PARTY} players max).`,
    NICK_TAKEN: 'Someone in that party already has your nickname.',
    KICKED: 'You were kicked from that party.',
    ALREADY_IN_PARTY: 'You are already in another party.',
    NOT_IN_PARTY: 'You are not in the party anymore.',
    NOT_HOST: 'Only the host can do that.',
    TARGET_NOT_FOUND: 'That player is not in the party anymore.',
    CANT_KICK_HOST: 'You cannot kick yourself.',
    INVALID_SETTINGS: `That combination goes over the ${MAX_FLAGS_PER_GAME} flag limit.`,
    NO_CODE_AVAILABLE: 'Could not generate a code. Try again.',

    ALREADY_PLAYING: 'The game already started.',
    NOT_PLAYING: 'There is no game running.',
    NO_FLAG_ACTIVE: 'Time just ran out for that flag.',
    ALREADY_ANSWERED: 'You already answered this flag.',
    NOT_ENOUGH_FLAGS: 'There are not enough flags for that setup.',
    GAME_NOT_FINISHED: 'The game is not over yet.',

    BAD_REQUEST: 'Invalid request.',
    NO_NICKNAME: 'Pick a nickname first.',
    SERVER_ERROR: 'Something broke on the server. Try again.',
    TIMEOUT: 'The server did not answer. Check your connection.',
    UNKNOWN: 'Unexpected error.',
  },
} as const;
