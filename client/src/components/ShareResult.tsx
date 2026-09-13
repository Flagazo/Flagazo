import { useState } from 'react';
import { useLocale, useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { Button } from './Button';

/** Lo que se cuenta al compartir. Sin puesto (vino a mirar) o jugando solo, invita a jugar y nada más. */
export interface ShareFacts {
  game: 'guess' | 'draw';
  position: number | null;
  players: number;
  points: number;
  /** Solo en Flag Guess. */
  correct?: number;
}

/**
 * "Compartir" en los resultados: los mismos jugadores son la mejor publicidad.
 *
 * En el celular abre el menú de compartir del sistema (WhatsApp, Instagram…). En
 * la computadora, donde casi nunca existe, copia el texto con el link.
 */
export function ShareResult({ facts }: { facts: ShareFacts }) {
  const t = useT();
  const locale = useLocale();
  const pushToast = useAppStore((s) => s.pushToast);
  const [sharing, setSharing] = useState(false);

  async function share() {
    const numbers = new Intl.NumberFormat(locale === 'es' ? 'es' : 'en', { useGrouping: 'always' });
    const texts = t.share;
    // Jugando solo, "quedé 1.º de 1" no dice nada: mejor la invitación.
    const text =
      facts.position === null || facts.players < 2
        ? texts.invite
        : facts.game === 'guess'
          ? texts.guess(texts.place(facts.position), facts.players, numbers.format(facts.points), facts.correct ?? 0)
          : texts.draw(texts.place(facts.position), facts.players, numbers.format(facts.points));
    // El link lleva de dónde vino la visita, para poder medir si compartir sirve.
    const url = `${window.location.origin}/?ref=share`;

    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Flagazo', text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        pushToast(texts.copied, 'success');
      }
    } catch (error) {
      // Cerrar el menú de compartir no es un error.
      if (!(error instanceof DOMException && error.name === 'AbortError')) pushToast(texts.failed, 'error');
    } finally {
      setSharing(false);
    }
  }

  return (
    <Button variant="cyan" icon="📤" onClick={() => void share()} disabled={sharing}>
      {t.share.button}
    </Button>
  );
}
