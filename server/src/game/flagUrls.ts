import { config } from '../config';

/**
 * URL definitiva de una bandera, ya revelada.
 *
 * El `?v=` cambia cuando se regeneran las banderas: sin él, quien tuviera las
 * anteriores en la caché del navegador seguiría viéndolas.
 */
export const flagFileUrl = (id: string) => `/flags/${id.toLowerCase()}.svg?v=${config.flagsVersion}`;

/** URL de una bandera todavía secreta, servida por su token. */
export const flagTokenUrl = (token: string) => `/flag/r/${token}`;
