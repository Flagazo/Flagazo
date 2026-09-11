import { memo } from 'react';
import { useAppStore } from '../store/useAppStore';
import './FlagBackground.css';

/** Banderas decorativas del fondo (solo en menús, nunca durante una ronda). */
/**
 * Seis filas, no cuatro: con menos, la franja no llegaba a cubrir todo el alto
 * y al despejar el centro las banderas quedaban amontonadas abajo.
 */
const ROWS: string[][] = [
  ['ar', 'jp', 'br', 'de', 'ke', 'ca', 'se', 'kr', 'mx', 'za', 'gr', 'in'],
  ['fr', 'ng', 'no', 'pe', 'tr', 'au', 'ch', 'co', 'it', 'np', 'jm', 'pt'],
  ['es', 'gb', 'cl', 'ua', 'eg', 'us', 'bt', 'uy', 'nl', 'vn', 'ie', 'cu'],
  ['fi', 'pk', 'ma', 'cz', 'bo', 'dk', 'lk', 'gh', 'nz', 'sc', 'kz', 'be'],
  ['is', 'th', 'ph', 'sn', 'hr', 'qa', 'et', 'my', 'at', 'il', 'tn', 'ee'],
  ['bd', 'rs', 'sk', 'py', 'gt', 'om', 'lt', 'mn', 'cr', 'ec', 'lv', 'do'],
];

export const FlagBackground = memo(function FlagBackground() {
  /*
   * Se espera al sello del servidor antes de pedir una sola bandera.
   *
   * Pedirlas sin `?v=` las resolvía contra la caché del navegador, que para
   * quien hubiera jugado antes del cambio a Wikimedia todavía guardaba el set
   * viejo: todas redibujadas a 4:3, con Suiza y Nepal deformadas. Al versionar
   * la URL, esas entradas quedan inalcanzables y no hay que pedirle a nadie que
   * limpie la caché a mano.
   *
   * Mientras no esté, no se dibuja nada: es decoración, y unos milisegundos sin
   * fondo no los ve nadie.
   */
  const version = useAppStore((s) => s.flagsVersion);
  if (!version) return null;

  return (
    <div className="flag-bg" aria-hidden="true">
      <div className="flag-bg__tilt">
        {ROWS.map((row, rowIndex) => (
          <div key={rowIndex} className={`flag-bg__row ${rowIndex % 2 ? 'flag-bg__row--reverse' : ''}`}>
            {/* La fila se duplica para que el desplazamiento sea un bucle sin cortes. */}
            {[...row, ...row].map((code, i) => (
              <img
                key={`${code}-${i}`}
                className="flag-bg__flag"
                src={`/flags/${code}.svg?v=${version}`}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});
