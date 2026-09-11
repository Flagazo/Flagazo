/**
 * Normalización de nombres de países.
 *
 * La MISMA función se usa para armar el índice y para lo que escribe el jugador:
 * si difirieran aunque sea en un detalle, respuestas correctas se darían por malas.
 *
 * "República Árabe Saharaui" y "republica arabe saharaui" tienen que terminar iguales,
 * y "The Gambia" tiene que poder responderse como "Gambia".
 */

/**
 * Letras que Unicode no descompone en "letra + tilde": hay que mapearlas a mano.
 * Sin esto, "Åland" y "Aland" no coincidirían, ni "Côte d'Ivoire" con "Cote d Ivoire".
 */
const SPECIAL_LETTERS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'ae',
  ø: 'o',
  Ø: 'o',
  ł: 'l',
  Ł: 'l',
  đ: 'd',
  Đ: 'd',
  ð: 'd',
  Ð: 'd',
  þ: 'th',
  Þ: 'th',
  œ: 'oe',
  Œ: 'oe',
  ı: 'i',
  '’': ' ',
  '‘': ' ',
  '´': ' ',
  '`': ' ',
};

/**
 * Marcas combinantes que van sobre letras latinas, griegas o cirílicas: ahí la tilde
 * es decorativa ("Perú" = "Peru"). En otras escrituras cambia la palabra, así que
 * el lookbehind las deja intactas.
 */
const ACCENTS_OVER_LATIN =
  /(?<=[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu;

/**
 * Artículos iniciales que se ignoran, para que "The Gambia" = "Gambia"
 * y "Los Países Bajos" = "Países Bajos". Solo se saca si queda algo después.
 */
const LEADING_ARTICLES = new Set([
  // inglés
  'the',
  // irlandés
  'an', 'na',
  // español / catalán
  'la', 'el', 'los', 'las', 'els',
  // francés
  'le', 'les', 'l',
  // alemán
  'die', 'der', 'das',
  // italiano
  'il', 'lo', 'gli', 'i',
  // portugués
  'a', 'o', 'as', 'os',
  // neerlandés
  'de', 'het',
]);

/**
 * Deja un texto en su forma canónica para comparar.
 * Devuelve "" si no queda nada útil (así el matcher lo descarta sin casos especiales).
 */
export function normalizeName(raw: string): string {
  if (typeof raw !== 'string') return '';

  let text = raw;
  for (const [from, to] of Object.entries(SPECIAL_LETTERS)) {
    if (text.includes(from)) text = text.split(from).join(to);
  }

  const cleaned = text
    .normalize('NFKD')
    // Solo se quitan las tildes de alfabetos donde son decorativas.
    // En devanagari, tamil, khmer o thaana los signos vocálicos son parte de
    // la palabra: borrarlos haría que "Maldivas" y "Moldova" fueran lo mismo.
    .replace(ACCENTS_OVER_LATIN, '')
    .toLowerCase()
    // Guiones y apóstrofes separan palabras: "Guinea-Bissau" = "Guinea Bissau".
    .replace(/[-–—'`]/g, ' ')
    // Cualquier otro signo se descarta: "U.S.A." = "usa". Se conservan las marcas
    // (\p{M}) que sobrevivieron al paso anterior: son las vocales de las escrituras
    // índicas y del khmer, sin las cuales no queda palabra.
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  return stripLeadingArticle(cleaned);
}

function stripLeadingArticle(text: string): string {
  const spaceAt = text.indexOf(' ');
  if (spaceAt <= 0) return text;
  const first = text.slice(0, spaceAt);
  if (!LEADING_ARTICLES.has(first)) return text;
  const rest = text.slice(spaceAt + 1);
  // "La" sola no es una respuesta; si sacar el artículo vacía el texto, se deja como está.
  return rest.length > 0 ? rest : text;
}
