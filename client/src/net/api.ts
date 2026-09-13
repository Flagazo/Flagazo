import type { ApiResult } from '@flagazo/shared';

/** Errores que no manda el servidor: los detecta el cliente. */
export type ClientApiError = 'NETWORK';

export type ClientApiResult<T> = ApiResult<T> | { ok: false; error: ClientApiError };

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Un archivo (la foto de perfil) en vez de JSON. */
  blob?: Blob;
}

/**
 * Pedido a la API HTTP del mismo servidor (`/api/...`).
 *
 * La sesión viaja sola en la cookie HttpOnly: este código nunca la ve, y por eso
 * tampoco puede filtrarla. Las escrituras van siempre como JSON (o como imagen,
 * para la foto), que es parte de la defensa contra CSRF del servidor.
 */
export async function apiRequest<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ClientApiResult<T>> {
  const method = options.method ?? (body === undefined && !options.blob ? 'GET' : 'POST');
  const hasJson = body !== undefined && !options.blob;
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: options.blob
        ? { 'content-type': options.blob.type }
        : hasJson
          ? { 'content-type': 'application/json' }
          : undefined,
      body: options.blob ?? (hasJson ? JSON.stringify(body) : undefined),
    });
    // Un proxy caído o un deploy en curso puede devolver HTML en vez de JSON.
    if (!response.headers.get('content-type')?.includes('application/json')) {
      return { ok: false, error: 'NETWORK' };
    }
    return (await response.json()) as ApiResult<T>;
  } catch {
    return { ok: false, error: 'NETWORK' };
  }
}
