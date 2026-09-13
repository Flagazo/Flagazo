import {
  AUTH_CODE,
  MAX_FLAGS_PER_GAME,
  MAX_PLAYERS_PER_PARTY,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  PARTY_CODE_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
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

  share: {
    button: 'Share',
    place: (position: number) => {
      const tens = position % 100;
      const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[position % 10] ?? 'th';
      return `${position}${suffix}`;
    },
    guess: (place: string, players: number, points: string, correct: number) =>
      `I finished ${place} of ${players} in Flagazo with ${points} points and ${correct} flags right. Think you can beat me?`,
    draw: (place: string, players: number, points: string) =>
      `I finished ${place} of ${players} drawing flags from memory in Flagazo (${points} pts). Think you can beat me?`,
    invite: 'Guess the flags of the world with friends, free and with no account needed. Up to 30 players!',
    copied: 'Copied! Paste it wherever you want.',
    failed: 'Could not share. Try again.',
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

  auth: {
    loginTab: 'Log in',
    registerTab: 'Create account',
    loginTitle: 'Welcome back',
    registerTitle: 'Create your account',
    pitch: 'Optional. Keep your profile, your stats and a spot in the rankings.',
    username: 'Username',
    usernameHelp: 'It is also your name in every party.',
    email: 'Email',
    password: 'Password',
    passwordHelp: `At least ${PASSWORD_MIN_LENGTH} characters.`,
    confirmPassword: 'Confirm password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    remember: 'Keep me signed in',
    submitLogin: 'Log in',
    submitRegister: 'Create account',
    sending: 'One moment…',
    guest: 'Play as a guest instead',
    /* En la pantalla de nickname, para quien todavía no tiene sesión. */
    prompt: 'Want to save your stats?',
    signIn: 'Log in',
    createAccount: 'Create account',
    account: 'Your account',
    logout: 'Log out',
    forgotLink: 'Forgot your password?',
    verifyTitle: 'Check your email',
    verifyText: (email: string) => `We sent a ${AUTH_CODE.length}-digit code to ${email}.`,
    spamHint: 'It can take a minute. Check your spam folder too.',
    code: 'Code',
    submitVerify: 'Verify',
    resend: 'Resend code',
    resendIn: (seconds: number) => `Resend in ${seconds} s`,
    codeResent: 'If that email has a pending code, a new one is on its way.',
    changeEmail: 'Use another email',
    forgotTitle: 'Reset your password',
    forgotText: 'Type the email of your account and we will send you a code.',
    submitForgot: 'Send code',
    resetTitle: 'Choose a new password',
    resetText: (email: string) => `If ${email} has an account, we just sent it a code.`,
    newPassword: 'New password',
    submitReset: 'Save password',
    backToLogin: 'Back to log in',
    welcome: (name: string) => `Email verified. Welcome, ${name}!`,
    welcomeBack: (name: string) => `Welcome back, ${name}!`,
    welcomeNew: (name: string) => `Account created. Welcome, ${name}!`,
    passwordChanged: 'Password changed. You are in!',
    continueWith: (provider: string) => `Continue with ${provider}`,
    orWithEmail: 'or with your email',
    linked: 'Account linked. Next time you can log in with it.',
    oauthErrors: {
      OAUTH_CANCELLED: 'You cancelled the log in. You can try again whenever you want.',
      OAUTH_STATE: 'That log in expired or did not start here. Try again.',
      OAUTH_FAILED: 'Could not log in with that account. Try again in a moment.',
      OAUTH_EMAIL_IN_USE: 'There is already an account with that email. Log in with your password and link it from your profile.',
      OAUTH_ALREADY_LINKED: 'That account is already linked to another Flagazo account.',
      OAUTH_NOT_CONFIGURED: 'That log in option is not available right now.',
    },
    loggedOut: 'You logged out. You can keep playing as a guest.',
    errors: {
      USERNAME_EMPTY: 'Pick a username.',
      USERNAME_TAKEN: 'That username is taken. Try another one.',
      EMAIL_EMPTY: 'Type your email.',
      EMAIL_INVALID: 'That does not look like an email.',
      EMAIL_NOT_VERIFIED: 'Verify your email first. We just sent you a code.',
      CODE_EMPTY: `Type the ${AUTH_CODE.length}-digit code.`,
      CODE_INVALID: 'That code is not right.',
      CODE_EXPIRED: 'That code expired. Ask for a new one.',
      CODE_LOCKED: 'Too many tries with that code. Ask for a new one.',
      ALREADY_VERIFIED: 'That email is already verified. Log in.',
      PASSWORD_TOO_SHORT: `At least ${PASSWORD_MIN_LENGTH} characters.`,
      PASSWORD_TOO_LONG: `At most ${PASSWORD_MAX_LENGTH} characters.`,
      PASSWORD_LIKE_ACCOUNT: 'Do not use your email or username as the password.',
      PASSWORD_TOO_COMMON: 'That password is too common. Pick another one.',
      PASSWORDS_DONT_MATCH: 'The passwords do not match.',
      INVALID_CREDENTIALS: 'Wrong email or password.',
      RATE_LIMITED: (seconds: number) => `Too many attempts. Try again in ${seconds} s.`,
      ACCOUNTS_DISABLED: 'Accounts are not available right now. You can still play as a guest.',
      NETWORK: 'Could not reach the server. Check your connection.',
      GENERIC: 'Something went wrong. Try again.',
    },
  },

  profile: {
    open: 'My profile',
    back: 'Back to menu',
    signedOut: 'You are not signed in anymore.',
    changePhoto: 'Change profile photo',
    editName: 'Edit name',
    save: 'Save',
    cancel: 'Cancel',
    nameSaved: 'Name updated.',
    verified: 'verified',
    memberSince: (date: string) => `Playing since ${date}`,
    photo: 'Profile photo',
    uploadPhoto: 'Upload photo',
    useProviderPhoto: (provider: string) => `Use my ${provider} photo`,
    removePhoto: 'Remove photo',
    photoHint: 'JPG, PNG or WebP. It is shown round in every party.',
    photoSaved: 'Photo updated.',
    photoRemoved: 'Photo removed.',
    linked: 'Linked accounts',
    linkedBadge: 'linked',
    link: 'Link',
    stats: 'Stats',
    statGames: 'Games',
    statWins: 'Wins',
    statBestStreak: 'Best streak',
    statCorrect: 'Correct answers',
    statAverage: 'Average time',
    statPoints: 'Ranking points',
    statsEmpty: 'Play a game and your stats show up here.',
    deleteTitle: 'Delete account',
    deleteText: 'Your profile, photo, stats and ranking spot are deleted for good. You can keep playing as a guest.',
    deleteOpen: 'Delete my account',
    deleteConfirm: (username: string) => `Type ${username} to confirm`,
    deletePassword: 'Your password',
    deleteSubmit: 'Delete forever',
    deleted: 'Your account was deleted. You are still playing as a guest.',
    errors: {
      AVATAR_INVALID: 'That file is not a JPG, PNG or WebP image we can use.',
      AVATAR_TOO_LARGE: 'That image is too big. Try a smaller one.',
      NO_PROVIDER_AVATAR: 'That account has no photo to use.',
      CONFIRMATION_INVALID: 'The name does not match.',
      WRONG_PASSWORD: 'Wrong password.',
      RATE_LIMITED: 'Too many changes in a row. Try again in a while.',
      NETWORK: 'Could not reach the server. Check your connection.',
    },
  },

  ranking: {
    open: 'Ranking',
    title: (month: string) => `${month} ranking`,
    titleAllTime: 'All-time ranking',
    allTime: 'All time',
    metricLabel: 'What is ranked',
    periodLabel: 'Month',
    metrics: { points: 'Points', wins: 'Wins', correct: 'Correct' },
    empty: 'Nobody has scored this month yet. Play a game and take the top spot!',
    error: 'Could not load the ranking. Try again in a moment.',
    play: 'Play now',
    yourPosition: 'Your position',
    guestPitch: 'Create an account to show up in the ranking.',
    rules: 'Games with at least 2 players count. Flag Guess and Draw Battle points add up.',
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
    drawSetup: (rounds: number, seconds: number) => `${rounds} flags to draw · ${seconds}s each`,
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
    game: 'Game mode',
    /*
     * Las variantes de Flag Guess antes se llamaban "Mode". Con dos juegos,
     * "Mode" y "Game mode" en la misma pantalla eran dos cosas con el mismo nombre.
     */
    mode: 'Twist',
    drawRounds: 'Rounds',
    drawRoundsHint: 'one flag each',
    drawSeconds: 'Time to draw',
    drawPrompt: 'What you get',
    drawPrompts: {
      name: 'Country name',
      flag: (seconds: number) => `The flag, ${seconds}s`,
    },
    drawPromptHints: {
      name: 'You read the name and draw the flag from memory.',
      flag: (seconds: number) =>
        `The flag shows for ${seconds} seconds and hides. Then, from memory.`,
    },
    drawSummary: (rounds: number, minutes: number) => `${rounds} flags to draw · ~${minutes} min`,
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

  kinds: {
    guess: {
      name: 'Flag Guess',
      description: 'A flag shows up and everyone races to name it.',
    },
    draw: {
      name: 'Draw Battle',
      description: 'Everyone gets the same country and draws its flag from memory. Best drawing wins.',
    },
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

  draw: {
    roundOf: (round: number, total: number) => `Round ${round}/${total}`,
    drawTheFlagOf: 'Draw the flag of',
    memorize: 'Memorize it!',
    fromMemory: 'Now, from memory ✍️',
    canvas: 'Drawing canvas',
    finish: 'Finish',
    finished: 'Done ✓',
    finishedCount: (done: number, total: number) => `${done} of ${total} finished`,
    timeUp: "⏰ Time's up!",
    judging: 'Comparing the drawings…',
    joinedLate: 'You joined mid-game: you draw in the next one 👀',
    limitReached: 'The drawing is full. Undo something to keep going.',

    tools: {
      label: 'Drawing tools',
      brush: 'Brush',
      eraser: 'Eraser',
      undo: 'Undo',
      redo: 'Redo',
      clear: 'Clear everything',
      size: 'Brush size',
      sizes: { thin: 'Thin', medium: 'Medium', thick: 'Thick' },
      colors: 'Colors',
      custom: 'Pick any color',
    },
    colors: {
      red: 'Red',
      maroon: 'Maroon',
      orange: 'Orange',
      yellow: 'Yellow',
      green: 'Green',
      darkGreen: 'Dark green',
      lightBlue: 'Light blue',
      blue: 'Blue',
      navy: 'Navy',
      purple: 'Purple',
      pink: 'Pink',
      brown: 'Brown',
      white: 'White',
      gray: 'Gray',
      black: 'Black',
    },

    realFlag: 'The real flag',
    emptyDrawing: 'Did not draw',
    finishedIn: (seconds: string) => `done in ${seconds}`,
    roundWinner: (names: string, many: boolean) => `🏆 ${names} ${many ? 'take' : 'takes'} the round`,
    noRoundWinner: 'Nobody drew anything: no winner this round',
    tieByTime: 'Same score: whoever finished first takes it',
    nextFlag: 'Next flag in a few seconds…',
    breakdown: {
      colors: 'Colors',
      layout: 'Placement',
      shape: 'Shape',
      elements: 'Elements',
    },

    standings: 'Draw Battle',
    pointsColumn: 'Pts',
    pointsTitle: 'Points on the scoreboard',
    averageColumn: 'Avg',
    averageTitle: 'Average drawing score',
    bestDrawing: (nickname: string, score: number) => `Best drawing: ${nickname} with ${score}/100`,
    winner: (nickname: string) => `${nickname} wins Draw Battle!`,
    tie: (names: string) => `Tie: ${names}`,
    noWinner: 'Nobody won a round',
    winnerRule: 'The best drawing of each round takes 1 point. Most points wins.',

    scoring: {
      title: 'How drawings are scored',
      intro: 'The server compares every drawing with the real flag, the same way for everyone.',
      colors: 'Colors: did you use the flag’s colors, in similar amounts?',
      layout: 'Placement: are they in the right place?',
      shape: 'Shape: does the drawing fill the canvas like the flag does?',
      elements:
        'Elements: did you include what makes the flag that flag (the disc, the leaf, the cross)? Forgetting it costs a lot.',
      style: 'Shaky lines, scribbled fill and skipped tiny details barely cost anything.',
      ties: 'Same score: whoever pressed Finish first takes the round.',
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
    ACCOUNT_IN_PARTY: 'Your account is already in that party, in another tab or device.',

    ALREADY_PLAYING: 'The game already started.',
    NOT_PLAYING: 'There is no game running.',
    NO_FLAG_ACTIVE: 'Time just ran out for that flag.',
    ALREADY_ANSWERED: 'You already answered this flag.',
    NOT_ENOUGH_FLAGS: 'There are not enough flags for that setup.',
    GAME_NOT_FINISHED: 'The game is not over yet.',
    WRONG_GAME: 'That belongs to a different game mode.',
    NOT_DRAWING: 'Time is up for this drawing.',
    ALREADY_FINISHED: 'You already finished this drawing.',
    STALE_ROUND: 'That drawing was for a round that is over.',
    INVALID_DRAWING: 'The drawing could not be sent. Try again.',

    BAD_REQUEST: 'Invalid request.',
    NO_NICKNAME: 'Pick a nickname first.',
    SERVER_ERROR: 'Something broke on the server. Try again.',
    TIMEOUT: 'The server did not answer. Check your connection.',
    UNKNOWN: 'Unexpected error.',
  },
} as const;
