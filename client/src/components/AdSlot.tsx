import { useEffect, useRef, useState } from 'react';
import './AdSlot.css';

/**
 * Dónde va el anuncio. Cada ubicación lleva su propio id en la red para poder
 * medirlas por separado y decidir con datos si alguna no vale la pena.
 *
 * No hay ubicación dentro de la partida a propósito: el juego es a contrarreloj
 * y en el modo Parpadeo la bandera se ve menos de medio segundo. Un anuncio al
 * lado compite con lo único que el jugador tiene que mirar.
 */
export type AdPlacement = 'lobby' | 'results';

const CLIENT = import.meta.env.VITE_ADS_CLIENT;
const SLOT_IDS: Record<AdPlacement, string | undefined> = {
  lobby: import.meta.env.VITE_ADS_SLOT_LOBBY,
  results: import.meta.env.VITE_ADS_SLOT_RESULTS,
};

/**
 * Cuánto se espera a que el anuncio se llene antes de plegar el espacio.
 *
 * Con bloqueador —frecuente en público que juega— el anuncio no llega nunca.
 * Plegar mueve un poco el layout, pero deja la pantalla limpia; la alternativa
 * es un rectángulo gris vacío para siempre, que se ve roto.
 */
const FILL_TIMEOUT_MS = 2500;

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * El script de la red se carga una sola vez y **solo si hay publicidad
 * configurada**: sin las variables de entorno no entra ningún script de
 * terceros, que es mejor para la velocidad y para la privacidad de quien juega.
 */
let loading: Promise<void> | null = null;

function loadNetwork(client: string): Promise<void> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    script.onload = () => resolve();
    // Casi siempre es un bloqueador, no un error: no se avisa nada, se pliega.
    script.onerror = () => reject(new Error('no se pudo cargar la red de anuncios'));
    document.head.appendChild(script);
  });
  return loading;
}

type State = 'esperando' | 'lleno' | 'vacio';

export function AdSlot({ placement }: { placement: AdPlacement }) {
  const slotId = SLOT_IDS[placement];
  const configured = Boolean(CLIENT && slotId);
  const unitRef = useRef<HTMLModElement>(null);
  const [state, setState] = useState<State>('esperando');

  useEffect(() => {
    if (!CLIENT || !slotId) return;
    let cancelled = false;

    loadNetwork(CLIENT)
      .then(() => {
        window.adsbygoogle = window.adsbygoogle ?? [];
        window.adsbygoogle.push({});
      })
      .catch(() => {
        if (!cancelled) setState('vacio');
      });

    const timer = setTimeout(() => {
      if (cancelled) return;
      // AdSense marca el `<ins>` cuando lo llena; si no, quedó sin inventario.
      const filled = unitRef.current?.getAttribute('data-ad-status') === 'filled';
      setState(filled ? 'lleno' : 'vacio');
    }, FILL_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slotId]);

  /*
   * Sin configurar y en desarrollo se dibuja el hueco, para poder ver cómo queda
   * la pantalla con el anuncio puesto sin tener todavía una cuenta aprobada. En
   * producción sin configurar no se dibuja nada.
   */
  if (!configured) {
    if (!import.meta.env.DEV) return null;
    return (
      <aside className="ad-slot ad-slot--placeholder" aria-hidden="true">
        espacio de anuncio · {placement}
      </aside>
    );
  }

  if (state === 'vacio') return null;

  return (
    <aside className="ad-slot" aria-label="Publicidad">
      <ins
        ref={unitRef}
        className="adsbygoogle ad-slot__unit"
        style={{ display: 'block' }}
        data-ad-client={CLIENT}
        data-ad-slot={slotId}
        data-ad-format="horizontal"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
