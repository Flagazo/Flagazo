/**
 * Capa curada a mano sobre i18n-iso-countries.
 *
 * El dataset es bueno para nombres formales pero no sabe nada de cómo habla la
 * gente ("EEUU", "Holanda"), ni de continentes, ni de qué tan conocida es una
 * bandera. Todo eso vive acá y `scripts/build-countries.ts` lo valida al generar.
 *
 * Regla: si algo se corrige, va con un comentario que diga por qué.
 */
import type { Continent } from '@flagazo/shared';

/**
 * Los 195 países del juego: 193 miembros de la ONU + Vaticano y Palestina
 * (observadores). Territorios y banderas históricas quedan afuera del MVP.
 *
 * Agrupados por continente porque es la única partición donde un país aparece
 * exactamente una vez: el build verifica que sumen 195 y que no haya repetidos.
 * Los transcontinentales van donde está la mayor parte de su territorio
 * (Rusia en Europa; Turquía, Chipre, Georgia, Armenia y Azerbaiyán en Asia).
 */
export const CONTINENTS: Record<Continent, readonly string[]> = {
  africa: [
    'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD',
    'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET',
    'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG',
    'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW',
    'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG',
    'TN', 'UG', 'ZM', 'ZW',
  ],
  americas: [
    'AG', 'AR', 'BS', 'BB', 'BZ', 'BO', 'BR', 'CA', 'CL', 'CO',
    'CR', 'CU', 'DM', 'DO', 'EC', 'SV', 'GD', 'GT', 'GY', 'HT',
    'HN', 'JM', 'MX', 'NI', 'PA', 'PY', 'PE', 'KN', 'LC', 'VC',
    'SR', 'TT', 'US', 'UY', 'VE',
  ],
  asia: [
    'AF', 'AM', 'AZ', 'BH', 'BD', 'BT', 'BN', 'KH', 'CN', 'CY',
    'GE', 'IN', 'ID', 'IR', 'IQ', 'IL', 'JP', 'JO', 'KZ', 'KW',
    'KG', 'LA', 'LB', 'MY', 'MV', 'MN', 'MM', 'NP', 'KP', 'OM',
    'PK', 'PH', 'QA', 'SA', 'SG', 'KR', 'LK', 'SY', 'TJ', 'TH',
    'TL', 'TR', 'TM', 'AE', 'UZ', 'VN', 'YE', 'PS',
  ],
  europe: [
    'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CZ', 'DK',
    'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV',
    'LI', 'LT', 'LU', 'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO',
    'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE',
    'CH', 'UA', 'GB', 'VA',
  ],
  oceania: ['AU', 'FJ', 'KI', 'MH', 'FM', 'NR', 'NZ', 'PW', 'PG', 'WS', 'SB', 'TO', 'TV', 'VU'],
};

/**
 * Qué tan reconocible es la bandera para alguien que no estudió el tema.
 * Lo que no esté en ninguna de estas dos listas queda como 'hard'.
 */
export const EASY = [
  'AR', 'AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'CL', 'CN', 'CO',
  'CU', 'DE', 'DK', 'EG', 'ES', 'FI', 'FR', 'GB', 'GR', 'IE',
  'IL', 'IN', 'IT', 'JM', 'JP', 'KR', 'MX', 'NL', 'NO', 'NZ',
  'PE', 'PL', 'PT', 'RU', 'SE', 'TR', 'UA', 'US', 'UY', 'VE', 'ZA',
] as const;

export const MEDIUM = [
  'AL', 'DZ', 'AO', 'AM', 'AZ', 'BD', 'BY', 'BA', 'BG', 'KH',
  'CM', 'CD', 'CI', 'CR', 'HR', 'CY', 'CZ', 'DO', 'EC', 'EE',
  'SV', 'ET', 'GE', 'GH', 'GT', 'HT', 'HN', 'HU', 'IS', 'ID',
  'IQ', 'IR', 'JO', 'KZ', 'KE', 'KP', 'KW', 'LB', 'LV', 'LY',
  'LT', 'LU', 'MC', 'MY', 'MT', 'MA', 'MM', 'NP', 'NI', 'NG',
  'PA', 'PK', 'PY', 'PH', 'RO', 'RS', 'SA', 'SN', 'SG', 'SK',
  'SI', 'SO', 'LK', 'SY', 'TH', 'TN', 'UZ', 'VA', 'VN', 'ZW',
  'MD', 'AE', 'QA', 'BO',
] as const;

/**
 * Nombres que la gente usa de verdad y el dataset no trae.
 * Los acentos y mayúsculas no importan: todo pasa por normalizeName.
 */
export const ALIASES: Record<string, string[]> = {
  US: ['EEUU', 'EE.UU.', 'USA', 'U.S.A.', 'Estados Unidos de América', 'United States of America'],
  GB: [
    'Reino Unido', 'Gran Bretaña', 'Great Britain', 'UK', 'U.K.',
    // En un juego de fiesta nadie dice "Reino Unido" viendo la Union Jack.
    'Inglaterra', 'England',
  ],
  NL: ['Holanda', 'Holland'],
  KR: ['Corea del Sur', 'South Korea', 'Corea Del Sur'],
  KP: ['Corea del Norte', 'North Korea'],
  MM: ['Birmania', 'Burma'],
  SZ: ['Suazilandia', 'Swazilandia', 'Swaziland'],
  CZ: ['Chequia', 'República Checa', 'Czechia', 'Czech Republic'],
  CI: ['Costa de Marfil', 'Ivory Coast'],
  CV: ['Cabo Verde', 'Cape Verde'],
  TL: ['Timor Oriental', 'East Timor', 'Timor-Leste'],
  VA: ['Vaticano', 'Ciudad del Vaticano', 'Vatican', 'Santa Sede'],
  AE: ['Emiratos Árabes Unidos', 'EAU', 'UAE', 'Emiratos'],
  CD: ['RD Congo', 'República Democrática del Congo', 'Congo Kinshasa', 'Zaire', 'DRC'],
  CG: ['República del Congo', 'Congo Brazzaville'],
  MK: ['Macedonia', 'Macedonia del Norte', 'North Macedonia'],
  MD: ['Moldavia'],
  BA: ['Bosnia', 'Bosnia y Herzegovina', 'Bosnia and Herzegovina'],
  PS: ['Palestina', 'Palestine'],
  LK: ['Ceilán', 'Ceylon'],
  IR: ['Persia'],
  LA: ['Laos'],
  ST: ['Santo Tomé y Príncipe', 'Sao Tome y Principe'],
  GQ: ['Guinea Ecuatorial', 'Equatorial Guinea'],
  GW: ['Guinea Bisáu', 'Guinea-Bisáu'],
  PG: ['Papúa Nueva Guinea', 'Papua Nueva Guinea'],
  CF: ['República Centroafricana', 'Centroáfrica'],
  DO: ['República Dominicana'],
  SS: ['Sudán del Sur', 'South Sudan'],
  NZ: ['Nueva Zelandia'],
  BN: ['Brunéi'],
  KH: ['Camboya'],
  TZ: ['Tanzania'],
  BY: ['Bielorrusia'],
  ME: ['Montenegro'],
  TR: ['Türkiye'],
};

/**
 * Términos que por sí solos no alcanzan para saber de qué país hablás.
 * No se cuentan como error: el juego pide que seas más específico.
 *
 * Solo van acá los casos donde **ningún** país es dueño del término suelto.
 * "Guinea" no entra: es el nombre propio de GN, aunque existan otras Guineas.
 */
export const AMBIGUOUS: Record<string, string[]> = {
  // El dataset trae "Congo" para los dos, en varios idiomas.
  congo: ['CG', 'CD'],
  kongo: ['CG', 'CD'],
  конго: ['CG', 'CD'],
  // Ninguna de las dos Coreas es "Corea" a secas.
  corea: ['KP', 'KR'],
  korea: ['KP', 'KR'],
  coree: ['KP', 'KR'],
  koree: ['KP', 'KR'],
};

/**
 * Nombres mal asignados en el dataset original. Se quitan del país equivocado
 * en vez de inventar el correcto: preferimos que falte un idioma a que un país
 * responda al nombre de otro.
 */
export const REMOVE_NAMES: Record<string, string[]> = {
  // En dhivehi el paquete le puso a Malaui el nombre de Malasia.
  MW: ['މެލޭޝިޔާ'],
  // Y a Mónaco el de Mongolia.
  MC: ['މޮންގޯލިއާ'],
};

/**
 * Banderas que se confunden entre sí. Todavía no se usan (es el modo
 * "parecidas" de la Fase 7), pero se curan ahora que estamos en los datos.
 * El build las simetriza: alcanza con declarar cada par una sola vez.
 */
export const SIMILAR: Record<string, string[]> = {
  TD: ['RO', 'MD'],
  MC: ['ID', 'PL'],
  NL: ['LU', 'PY'],
  IE: ['CI', 'IT'],
  SI: ['SK', 'RU'],
  AU: ['NZ'],
  NO: ['IS', 'DK', 'FI', 'SE'],
  CO: ['EC', 'VE'],
  SN: ['ML', 'GN', 'CM'],
  AT: ['LV'],
  EG: ['IQ', 'SY', 'YE'],
  BE: ['DE'],
  AR: ['UY', 'NI', 'SV'],
  QA: ['BH'],
  CH: ['DK'],
};

/**
 * Nombre para mostrar en pantalla cuando el del dataset queda incómodo.
 * Solo cambia lo que ve el jugador: los nombres aceptados como respuesta
 * siguen siendo todos los del dataset más los alias.
 */
export const DISPLAY_ES: Record<string, string> = {
  CD: 'República Democrática del Congo',
  // El dataset lo llama solo "Congo", que no lo distingue del anterior.
  CG: 'República del Congo',
  KP: 'Corea del Norte',
  KR: 'Corea del Sur',
  LA: 'Laos',
};
