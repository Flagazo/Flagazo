import { DRAW_BRUSH_SIZES, DRAW_CANVAS, strokeHex } from '@flagazo/shared';
import type { Stroke } from '@flagazo/shared';

/**
 * Pinta trazos en un canvas del navegador.
 *
 * La usan el lienzo donde se dibuja y la galería de la revelación: lo que ve el
 * que dibuja y lo que ven los demás sale de la misma función. El servidor pinta
 * con cápsulas (segmentos de puntas redondas), que es exactamente lo que dibuja
 * `lineCap: 'round'`, así que lo puntuado y lo mostrado coinciden.
 *
 * Se pinta sobre un canvas transparente con fondo blanco por CSS: el borrador
 * perfora la tinta (`destination-out`) y deja ver ese blanco, que es lo mismo
 * que "lienzo sin pintar" para el servidor.
 */
export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[]) {
  const scale = ctx.canvas.width / DRAW_CANVAS.width;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const stroke of strokes) paintStroke(ctx, stroke, scale);
  ctx.globalCompositeOperation = 'source-over';
}

export function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, scale: number, from = 0) {
  const { points } = stroke;
  if (points.length < 2) return;

  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#000' : strokeHex(stroke);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = (DRAW_BRUSH_SIZES[stroke.size] ?? 1) * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Un toque sin arrastrar es un punto: un segmento de largo 0 no se ve.
  if (points.length === 2) {
    ctx.beginPath();
    ctx.arc(points[0]! * scale, points[1]! * scale, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const start = Math.max(0, from - 2);
  ctx.beginPath();
  ctx.moveTo(points[start]! * scale, points[start + 1]! * scale);
  for (let i = start + 2; i < points.length; i += 2) {
    ctx.lineTo(points[i]! * scale, points[i + 1]! * scale);
  }
  ctx.stroke();
}
