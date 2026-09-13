/**
 * Límite de intentos por clave (una IP, un email) dentro de una ventana de tiempo.
 *
 * Vive en memoria, igual que las parties: con una sola instancia es exacto y no
 * suma infraestructura. Si algún día hay varias, esto pasa a Redis junto con las
 * salas. Un reinicio lo pone en cero, lo cual es aceptable: el hash lento sigue
 * haciendo impracticable probar contraseñas en masa.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Registra un intento. Si ya se pasó del límite, no lo cuenta y dice cuánto
   * falta para que se libere el más viejo.
   */
  hit(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
    const recent = this.recent(key, now);
    if (recent.length >= this.limit) {
      return { ok: false, retryAfterMs: Math.max(1, recent[0]! + this.windowMs - now) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true };
  }

  /** Olvida los intentos de una clave: por ejemplo, tras un login correcto. */
  reset(key: string) {
    this.hits.delete(key);
  }

  /** Borra claves sin intentos recientes, para que el mapa no crezca sin fin. */
  sweep(now = Date.now()) {
    for (const key of this.hits.keys()) {
      if (this.recent(key, now).length === 0) this.hits.delete(key);
    }
  }

  private recent(key: string, now: number): number[] {
    const list = this.hits.get(key);
    if (!list) return [];
    const fresh = list.filter((time) => now - time < this.windowMs);
    if (fresh.length !== list.length) this.hits.set(key, fresh);
    return fresh;
  }
}
