import { DRAW_BRUSH_SIZES, DRAW_PALETTE } from '@flagazo/shared';
import type { DrawTool } from '@flagazo/shared';
import { useT } from '../../i18n';
import './DrawToolbar.css';

interface Props {
  tool: DrawTool;
  color: string;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
  disabled: boolean;
  onTool(tool: DrawTool): void;
  onColor(color: string): void;
  onSize(size: number): void;
  onUndo(): void;
  onRedo(): void;
  onClear(): void;
}

const SIZE_KEYS = ['thin', 'medium', 'thick'] as const;

/**
 * Las herramientas, todas a un toque.
 *
 * Nada de menús ni paneles que se abren: con 30 segundos por bandera, cada
 * segundo buscando una herramienta es un segundo sin dibujar. Elegir un color
 * vuelve al pincel, porque nadie elige un color para borrar.
 */
export function DrawToolbar(props: Props) {
  const t = useT();
  const { tool, color, size, disabled } = props;
  const isCustom = !DRAW_PALETTE.some((entry) => entry.id === color);

  return (
    <div className="draw-toolbar" role="toolbar" aria-label={t.draw.tools.label}>
      <div className="draw-toolbar__colors" role="radiogroup" aria-label={t.draw.tools.colors}>
        {DRAW_PALETTE.map((entry) => {
          const selected = tool === 'brush' && color === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={t.draw.colors[entry.id]}
              title={t.draw.colors[entry.id]}
              className={`draw-swatch ${selected ? 'draw-swatch--selected' : ''}`}
              style={{ background: entry.hex }}
              disabled={disabled}
              onClick={() => {
                props.onColor(entry.id);
                props.onTool('brush');
              }}
            />
          );
        })}

        {/* El color personalizado es secundario: queda al final, con otra pinta. */}
        <label
          className={`draw-swatch draw-swatch--custom ${tool === 'brush' && isCustom ? 'draw-swatch--selected' : ''}`}
          title={t.draw.tools.custom}
          style={isCustom ? { background: color } : undefined}
        >
          <input
            type="color"
            className="visually-hidden"
            aria-label={t.draw.tools.custom}
            value={isCustom ? color : '#ff00aa'}
            disabled={disabled}
            onChange={(event) => {
              props.onColor(event.target.value);
              props.onTool('brush');
            }}
          />
          {!isCustom && <span aria-hidden="true">＋</span>}
        </label>
      </div>

      <div className="draw-toolbar__row">
        <div className="draw-toolbar__group">
          <ToolButton
            label={t.draw.tools.brush}
            icon="✏️"
            active={tool === 'brush'}
            disabled={disabled}
            onClick={() => props.onTool('brush')}
          />
          <ToolButton
            label={t.draw.tools.eraser}
            icon="🧽"
            active={tool === 'eraser'}
            disabled={disabled}
            onClick={() => props.onTool('eraser')}
          />
        </div>

        <div className="draw-toolbar__group" role="radiogroup" aria-label={t.draw.tools.size}>
          {DRAW_BRUSH_SIZES.map((diameter, index) => (
            <button
              key={diameter}
              type="button"
              role="radio"
              aria-checked={size === index}
              aria-label={t.draw.tools.sizes[SIZE_KEYS[index]!]}
              title={t.draw.tools.sizes[SIZE_KEYS[index]!]}
              className={`draw-tool draw-size ${size === index ? 'draw-tool--active' : ''}`}
              disabled={disabled}
              onClick={() => props.onSize(index)}
            >
              <span className="draw-size__dot" style={{ width: 6 + index * 7, height: 6 + index * 7 }} />
            </button>
          ))}
        </div>

        <div className="draw-toolbar__group">
          <ToolButton label={t.draw.tools.undo} icon="↩️" disabled={disabled || !props.canUndo} onClick={props.onUndo} />
          <ToolButton label={t.draw.tools.redo} icon="↪️" disabled={disabled || !props.canRedo} onClick={props.onRedo} />
          <ToolButton label={t.draw.tools.clear} icon="🗑️" disabled={disabled || !props.canUndo} onClick={props.onClear} />
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  icon,
  active = false,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  active?: boolean;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={`draw-tool ${active ? 'draw-tool--active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
