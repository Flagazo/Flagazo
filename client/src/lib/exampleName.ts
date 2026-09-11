/**
 * El nombre que aparece de ejemplo en el campo de nickname.
 *
 * Sale uno al azar en cada carga en vez de estar siempre el mismo: así se lee
 * como una sugerencia y no como un valor puesto de fábrica, y de paso el juego
 * se siente un poco más vivo desde la primera pantalla.
 *
 * Son de todos lados a propósito, que es de lo que va el juego. Todos entran en
 * las reglas de `validateNickname` (2 a 16 caracteres, letras y poco más), así
 * que si alguien escribe el ejemplo tal cual, funciona.
 */
const NAMES = [
  'Anya',
  'Lucía',
  'Aiko',
  'Diego',
  'Zara',
  'Kofi',
  'Nina',
  'Omar',
  'Freya',
  'Mei',
  'Sofía',
  'Liam',
  'Noor',
  'Íker',
  'Tomás',
  'Yuki',
  'Amara',
  'Bruno',
  'Elsa',
  'Ravi',
  'Chiara',
  'João',
  'Nadia',
  'Luca',
] as const;

/**
 * Uno al azar.
 *
 * Se elige una sola vez por carga y no en cada render: si cambiara mientras
 * escribís, el ejemplo saltaría solo y parecería un error.
 */
export const EXAMPLE_NAME: string = NAMES[Math.floor(Math.random() * NAMES.length)]!;
