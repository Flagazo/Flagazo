import { hash, verify } from '@node-rs/argon2';
import { COMMON_PASSWORDS } from './commonPasswords';

/**
 * Argon2id con los parámetros mínimos que recomienda OWASP: 19 MiB, 2 pasadas,
 * 1 hilo. Un hash tarda unos 30 ms.
 *
 * Se eligió Argon2id y no scrypt por la memoria: el plan de Render tiene 512 MB,
 * y un scrypt con parámetros equivalentes pide más de 100 MB por hash. Cuatro
 * logins a la vez alcanzarían para tirar el proceso.
 */
// Sin `algorithm`: el default de la librería ya es Argon2id (y el enum es `const`,
// que no se puede importar con `verbatimModuleSyntax`). El test lo verifica.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    // Un hash corrupto o de otro formato no es un error del servidor: no coincide.
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Gasta lo mismo que verificar una contraseña de verdad, sin cuenta detrás.
 *
 * Sin esto, "ese email no existe" responde en 1 ms y "contraseña incorrecta" en
 * 30 ms, y cronometrando el login se puede averiguar quién tiene cuenta.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('flagazo-no-es-una-cuenta');
  await verifyPassword(await dummyHash, password);
}

/** ¿Está entre las contraseñas que se prueban primero en cualquier ataque? */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
