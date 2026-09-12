import { useEffect, useMemo, useRef } from 'react';
import { decodeDrawing } from '@flagazo/shared';
import { paintStrokes } from './paintStrokes';
import './DrawCanvas.css';

/**
 * Un dibujo ya terminado, re-dibujado desde sus trazos.
 *
 * No viajan imágenes: cada cliente vuelve a pintar los trazos a la resolución de
 * su pantalla, así se ven nítidos en cualquier tamaño y no pesan casi nada.
 */
export function DrawingView({ encoded, label }: { encoded: string | null; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useMemo(() => {
    if (!encoded) return [];
    const result = decodeDrawing(encoded);
    return result.ok ? result.drawing.strokes : [];
  }, [encoded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      paintStrokes(canvas.getContext('2d')!, strokes);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [strokes]);

  return <canvas ref={canvasRef} className="draw-canvas draw-canvas--view" role="img" aria-label={label} />;
}
