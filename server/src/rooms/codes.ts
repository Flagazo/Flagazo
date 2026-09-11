import { randomInt } from 'node:crypto';
import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH } from '@flagazo/shared';

/**
 * Genera un código de party que todavía no exista.
 *
 * Con ~28 millones de combinaciones las colisiones son rarísimas, pero se
 * verifican igual: un código repetido metería a dos grupos en la misma sala.
 * `randomInt` (CSPRNG) evita que alguien pueda predecir códigos ajenos.
 */
export function generatePartyCode(exists: (code: string) => boolean, attempts = 50): string | null {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let code = '';
    for (let i = 0; i < PARTY_CODE_LENGTH; i++) {
      code += PARTY_CODE_ALPHABET[randomInt(PARTY_CODE_ALPHABET.length)];
    }
    if (!exists(code)) return code;
  }
  return null;
}
