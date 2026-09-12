import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, Ref } from 'react';
import { DRAW_CANVAS, clampToCanvas, simplifyPoints } from '@flagazo/shared';
import type { DrawTool, Stroke } from '@flagazo/shared';
import { paintStroke, paintStrokes } from './paintStrokes';
import './DrawCanvas.css';

export interface DrawCanvasHandle {
  /**
   * Cierra el trazo que está en curso, si hay uno, y lo devuelve.
   *
   * Existe para cuando el tiempo se acaba con el dedo apoyado: sin esto, ese
   * último trazo quedaría afuera del dibujo que se manda.
   */
  flush(): Stroke | null;
}

/** El pincel con el que se dibuja el próximo trazo. */
export interface Brush {
  tool: DrawTool;
  color: string;
  size: number;
}

interface Props {
  strokes: readonly Stroke[];
  /**
   * El pincel actual, como referencia y no como valores sueltos.
   *
   * Con props, un trazo empezado justo después de elegir un color podía salir
   * del color anterior si React todavía no había vuelto a renderizar: el
   * handler veía las props viejas. La referencia se actualiza en el mismo clic.
   */
  brush: { readonly current: Brush };
  locked: boolean;
  label: string;
  /** Devuelve false si el trazo no entra (tope de tamaño): se borra de la pantalla. */
  onStroke(stroke: Stroke): boolean;
  ref?: Ref<DrawCanvasHandle>;
}

/** Menos que esto entre dos puntos no aporta y engorda el dibujo. En unidades del lienzo. */
const MIN_STEP = 1.5;

/**
 * El lienzo donde se dibuja.
 *
 * Funciona igual con mouse, dedo y lápiz: los eventos de puntero unifican los
 * tres. Un solo puntero a la vez, así apoyar la palma o un segundo dedo no raya.
 * Los gestos del navegador (scroll, zoom, menú del toque largo) quedan anulados
 * sobre el lienzo con CSS y `preventDefault`.
 */
export function DrawCanvas({ strokes, brush, locked, label, onStroke, ref }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const active = useRef<{ pointerId: number; stroke: Stroke } | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const repaint = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    paintStrokes(ctx, strokesRef.current);
    if (active.current) paintStroke(ctx, active.current.stroke, ctx.canvas.width / DRAW_CANVAS.width);
  }, []);

  // El canvas se dibuja a la resolución real de la pantalla (devicePixelRatio),
  // si no, en un celular se ve borroso.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      repaint();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [repaint]);

  useEffect(() => {
    repaint();
  }, [strokes, repaint]);

  const finish = useCallback((): Stroke | null => {
    const current = active.current;
    if (!current) return null;
    active.current = null;
    const stroke = { ...current.stroke, points: simplifyPoints(current.stroke.points, 1) };
    if (onStroke(stroke)) return stroke;
    // No entró: ya estaba pintado mientras se dibujaba, así que hay que sacarlo.
    repaint();
    return null;
  }, [onStroke, repaint]);

  useImperativeHandle(ref, () => ({ flush: finish }), [finish]);

  // Si el lienzo se bloquea a mitad de un trazo, el trazo se cierra y cuenta.
  useEffect(() => {
    if (locked) finish();
  }, [locked, finish]);

  function toCanvas(clientX: number, clientY: number): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return clampToCanvas(
      ((clientX - rect.left) / rect.width) * DRAW_CANVAS.width,
      ((clientY - rect.top) / rect.height) * DRAW_CANVAS.height,
    );
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (locked || active.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try {
      // Que el trazo siga aunque el dedo se salga del lienzo. Si el navegador no
      // puede capturar ese puntero, se dibuja igual: no vale la pena perder el trazo.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* sin captura */
    }

    const [x, y] = toCanvas(event.clientX, event.clientY);
    const { tool, color, size } = brush.current;
    active.current = { pointerId: event.pointerId, stroke: { tool, color, size, points: [x, y] } };
    const ctx = event.currentTarget.getContext('2d')!;
    paintStroke(ctx, active.current.stroke, ctx.canvas.width / DRAW_CANVAS.width);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;

    const points = current.stroke.points;
    const before = points.length;
    // Los eventos intermedios que el navegador agrupó: sin ellos, un trazo rápido
    // sale en líneas rectas.
    // Ojo: puede venir una lista vacía y no `undefined`, y ahí hay que usar el evento mismo.
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const samples = coalesced.length > 0 ? coalesced : [event.nativeEvent];
    for (const sample of samples) {
      const [x, y] = toCanvas(sample.clientX, sample.clientY);
      const lastX = points[points.length - 2]!;
      const lastY = points[points.length - 1]!;
      if (Math.hypot(x - lastX, y - lastY) >= MIN_STEP) points.push(x, y);
    }
    if (points.length === before) return;

    const ctx = event.currentTarget.getContext('2d')!;
    paintStroke(ctx, current.stroke, ctx.canvas.width / DRAW_CANVAS.width, before);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (active.current?.pointerId !== event.pointerId) return;
    finish();
  }

  return (
    <canvas
      ref={canvasRef}
      className={`draw-canvas ${locked ? 'draw-canvas--locked' : ''} draw-canvas--${brush.current.tool}`}
      aria-label={label}
      role="img"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
