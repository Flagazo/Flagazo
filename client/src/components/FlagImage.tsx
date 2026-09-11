import { useEffect, useRef, useState } from 'react';
import type { FlagPresentation } from '@flagazo/shared';
import './FlagImage.css';

interface FlagImageProps {
  url: string;
  alt: string;
  /** Efecto del modo de juego, o null para verla tal cual. */
  presentation: FlagPresentation | null;
  /** Cuánto se lleva jugado de la bandera, de 0 a 1. */
  progress: number;
  /**
   * Cuánto se lleva jugado, en ms.
   *
   * Es lo mismo que `progress` pero en absoluto: el modo `flash` necesita
   * comparar contra medio segundo, y medio segundo no es una fracción fija del
   * tiempo de la bandera (cambia si el host pone 10 o 30 segundos).
   */
  elapsedMs: number;
}

/** Cuánta intensidad queda del efecto. Los que no se aflojan quedan al máximo. */
function intensityOf(presentation: FlagPresentation, progress: number): number {
  if (!presentation.fades) return 1;
  // Se afloja rápido al principio y despacio al final: la bandera se vuelve
  // adivinable a mitad de camino, y el que espera hasta el final la ve entera.
  return Math.max(0, 1 - progress) ** 0.7;
}

/**
 * La bandera, con el efecto del modo aplicado.
 *
 * Los efectos son puramente visuales y viven en el cliente: el servidor solo
 * dice **cuál** aplicar. Así, cambiar cómo se ve un modo no toca el motor.
 */
export function FlagImage({ url, alt, presentation, progress, elapsedMs }: FlagImageProps) {
  // Pixelar de verdad no se puede con filtros CSS: hay que redibujar chico.
  if (presentation?.effect === 'pixelated') {
    return <PixelatedFlag url={url} alt={alt} intensity={intensityOf(presentation, progress)} />;
  }

  if (presentation?.effect === 'flash') {
    return (
      <FlashFlag
        url={url}
        alt={alt}
        visibleMs={presentation.visibleMs ?? 0}
        elapsedMs={elapsedMs}
      />
    );
  }

  const style: React.CSSProperties = {};
  if (presentation) {
    const intensity = intensityOf(presentation, progress);
    if (presentation.effect === 'grayscale') {
      style.filter = 'grayscale(1)';
    } else if (presentation.effect === 'cropped') {
      // Se agranda dentro del recuadro: se ve un pedacito muy de cerca y la
      // "cámara" se va alejando. El recorte lo hace el overflow del contenedor.
      style.transform = `scale(${(1 + intensity * 7).toFixed(2)})`;
    }
  }

  return (
    <img
      className="flag-card__image"
      key={url}
      src={url}
      alt={alt}
      style={style}
      draggable={false}
    />
  );
}

/** Si la imagen no llegó en este rato, el fogonazo se da por perdido. */
const FLASH_LOAD_GRACE_MS = 3_000;

/**
 * Fogonazo: la bandera se ve un instante y se tapa.
 *
 * La cuenta arranca cuando la imagen **terminó de cargar**, no cuando arrancó la
 * bandera. Medido sobre una conexión real, la imagen tardaba ~420 ms en llegar
 * —la bandera activa se pide con `no-store`, así que nunca está en caché— y el
 * fogonazo entero se iba en la espera: el jugador alcanzaba a ver 30 ms. Y como
 * cada uno tiene su conexión, cada uno veía una cantidad distinta, que es lo
 * peor que le puede pasar a un modo que se trata justamente de cuánto viste.
 *
 * El precio de contar desde la carga es que quien tiene peor conexión la ve más
 * tarde, y por lo tanto responde más tarde y cobra menos bonus de velocidad.
 * Pero la ve: es mucho mejor que la alternativa.
 */
function FlashFlag({
  url,
  alt,
  visibleMs,
  elapsedMs,
}: {
  url: string;
  alt: string;
  visibleMs: number;
  elapsedMs: number;
}) {
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (readyAt === null) return;
    const timer = setTimeout(() => setOver(true), visibleMs);
    return () => clearTimeout(timer);
  }, [readyAt, visibleMs]);

  /*
   * Se perdió el momento: o la imagen tardó demasiado, o el jugador se
   * reconectó con la bandera ya empezada. En los dos casos la encuentra tapada,
   * en vez de recibir un fogonazo nuevo a destiempo.
   */
  const missed = readyAt === null && elapsedMs > FLASH_LOAD_GRACE_MS;
  if (over || missed) return <HiddenFlag />;

  return (
    <img
      className="flag-card__image"
      key={url}
      src={url}
      alt={alt}
      draggable={false}
      onLoad={() => setReadyAt((at) => at ?? performance.now())}
    />
  );
}

/**
 * El hueco que queda cuando ya pasó el fogonazo.
 *
 * No dice nada del país: es solo la señal de que el momento de mirar terminó y
 * ahora toca escribir.
 */
function HiddenFlag() {
  return (
    <div className="flag-hidden" aria-hidden="true">
      <span className="flag-hidden__mark">?</span>
    </div>
  );
}

/**
 * Pixelado real: se dibuja la bandera en un canvas chiquito y se estira.
 *
 * Un `filter: blur()` haría una mancha; esto conserva los bloques de color, que
 * es lo que deja adivinar la bandera de a poco.
 */
/** Ancho fijo del canvas visible. Suficiente para que la bandera se vea nítida al final. */
const CANVAS_WIDTH = 640;

/** Lienzo auxiliar donde se hace la reducción. Uno solo para toda la app. */
const scratch = document.createElement('canvas');

function PixelatedFlag({ url, alt, intensity }: { url: string; alt: string; intensity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /*
   * La imagen va en estado y no en un ref: cargarla es asincrónico, y si el
   * resultado no dispara un render, el canvas se queda vacío para siempre
   * (nadie lo vuelve a dibujar después de que la imagen llegó).
   */
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const loaded = new Image();
    let cancelled = false;
    loaded.onload = () => {
      if (!cancelled) setImage(loaded);
    };
    loaded.src = url;
    return () => {
      cancelled = true;
      setImage(null);
    };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Todavía no cargó la bandera de esta ronda: se deja el canvas vacío en vez
    // de arrastrar lo último que se dibujó, que sería la bandera anterior.
    if (!image?.complete || !image.naturalWidth) {
      canvas.width = 1;
      canvas.height = 1;
      return;
    }

    /*
     * El canvas visible mide siempre lo mismo y con la proporción real de la
     * bandera: la imagen no cambia de tamaño mientras se juega, solo se le
     * afloja el pixelado encima. Antes el canvas era del tamaño de los bloques
     * y parecía una bandera chiquita que iba creciendo.
     */
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = CANVAS_WIDTH;
    const height = Math.round(CANVAS_WIDTH / ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    // De 3 bloques de ancho (irreconocible) a 160 (prácticamente nítida).
    const blocks = Math.max(3, Math.round(3 + (1 - intensity) ** 2 * 157));
    const smallW = blocks;
    const smallH = Math.max(2, Math.round(blocks / ratio));

    // Se reduce a la grilla de bloques y se vuelve a agrandar sin suavizado:
    // ese ida y vuelta es lo que deja los bloques marcados.
    scratch.width = smallW;
    scratch.height = smallH;
    const scratchContext = scratch.getContext('2d');
    if (!scratchContext) return;
    scratchContext.imageSmoothingEnabled = false;
    scratchContext.clearRect(0, 0, smallW, smallH);
    scratchContext.drawImage(image, 0, 0, smallW, smallH);

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, width, height);
    context.drawImage(scratch, 0, 0, smallW, smallH, 0, 0, width, height);
  });

  return (
    <canvas
      ref={canvasRef}
      className="flag-card__image flag-card__image--pixelated"
      role="img"
      aria-label={alt}
    />
  );
}
