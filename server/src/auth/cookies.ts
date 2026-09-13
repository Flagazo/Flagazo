/**
 * Lectura de cookies sin dependencias.
 *
 * Se usa en dos lugares: en las rutas HTTP y, más adelante, en el handshake del
 * WebSocket, que trae los headers de la página pero no pasa por Express.
 */
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!name || cookies.has(name)) continue;
    try {
      cookies.set(name, decodeURIComponent(raw));
    } catch {
      // Un valor mal codificado no es de esta app: se ignora.
    }
  }
  return cookies;
}
