import { useLayoutEffect, useRef } from 'react';

/**
 * Anima el reordenamiento de una lista (técnica FLIP).
 *
 * Cuando alguien pasa a otro en la tabla, React reordena el DOM y las filas
 * saltan de golpe: es el momento más lindo del juego y se pierde. Acá se mide
 * dónde estaba cada fila **antes** del reordenamiento y se la hace viajar desde
 * ahí hasta su lugar nuevo.
 *
 * Se usa la Web Animations API en vez de transiciones CSS porque las filas
 * cambian de posición en el flujo del documento, no de estilo.
 *
 * Cada elemento animable tiene que llevar `data-reorder-key` con un id estable.
 */
export function useReorder<T extends HTMLElement>(container: React.RefObject<T | null>) {
  /** Posición vertical de cada fila en el render anterior. */
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;

    // Quien pidió menos movimiento no quiere que las filas vuelen por la pantalla.
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const rows = root.querySelectorAll<HTMLElement>('[data-reorder-key]');
    const seen = new Set<string>();

    for (const row of rows) {
      const key = row.dataset.reorderKey;
      if (!key) continue;
      seen.add(key);

      const top = row.getBoundingClientRect().top;
      const before = positions.current.get(key);
      positions.current.set(key, top);

      if (quieto || before === undefined) continue;
      const delta = before - top;
      // Un píxel de diferencia es ruido de layout, no un cambio de puesto.
      if (Math.abs(delta) < 1) continue;

      row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }

    // Los que ya no están dejan de ocupar lugar en el registro.
    for (const key of positions.current.keys()) {
      if (!seen.has(key)) positions.current.delete(key);
    }
  });
}
