import { storage } from '../lib/storage';
import { RECIPES } from './sounds';
import type { Note, SoundName } from './sounds';

/**
 * Reproductor de los sonidos del juego.
 *
 * Dos cosas que hay que respetar sí o sí:
 *
 * 1. **Los navegadores bloquean el audio hasta que la persona interactúa.** Por
 *    eso el AudioContext se crea recién en el primer clic o tecla, y no al cargar
 *    la página: crearlo antes lo deja "suspendido" y el primer sonido se pierde.
 * 2. **Un juego que suena sin permiso es molesto.** Arranca silenciado si así
 *    quedó la última vez, y el estado se recuerda entre visitas.
 *
 * Los sonidos son sintetizados (ver `sounds.ts`). Para pasar a archivos reales
 * alcanza con reemplazar `playRecipe`.
 */
class SoundManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = storage.getMuted();
  private listeners = new Set<(muted: boolean) => void>();

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Prepara el audio en el primer gesto de la persona.
   * Se llama en cada interacción; después de la primera no hace nada.
   */
  unlock = () => {
    if (this.context) {
      // Algunos navegadores lo suspenden al volver de otra pestaña.
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.context.destination);
    } catch {
      // Sin Web Audio el juego funciona igual, solo que en silencio.
      this.context = null;
    }
  };

  setMuted(muted: boolean) {
    this.muted = muted;
    storage.setMuted(muted);
    for (const listener of this.listeners) listener(muted);
  }

  toggleMuted() {
    this.setMuted(!this.muted);
  }

  /** Avisa cuando cambia el silencio, para que el botón se mantenga al día. */
  subscribe(listener: (muted: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(name: SoundName) {
    if (this.muted) return;
    this.unlock();
    if (!this.context || !this.master) return;
    this.playRecipe(RECIPES[name]);
  }

  private playRecipe(notes: readonly Note[]) {
    const context = this.context!;
    const now = context.currentTime;

    for (const note of notes) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();

      oscillator.type = note.type ?? 'sine';
      oscillator.frequency.value = note.freq;

      const start = now + note.at / 1000;
      const end = start + note.ms / 1000;
      const peak = note.gain ?? 0.3;

      // Ataque y caída suaves: un tono que arranca y corta de golpe chasquea.
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(peak, start + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(envelope);
      envelope.connect(this.master!);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  }
}

export const sound = new SoundManager();

/** Un solo enganche global: cualquier gesto habilita el audio. */
export function initAudioUnlock() {
  const unlock = () => sound.unlock();
  for (const event of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(event, unlock, { passive: true });
  }
}
