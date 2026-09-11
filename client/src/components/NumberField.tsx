import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import './NumberField.css';

interface NumberFieldProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  /** Cuánto suma o resta cada botón. */
  step?: number;
  /** Se llama con un valor ya validado, no en cada tecla. */
  onCommit: (value: number) => void;
  readOnly?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Campo numérico que el host escribe a mano, con botones para ajustar de a poco.
 *
 * El valor no se envía en cada tecla: escribir "40" pasa por "4", que es inválido
 * y el servidor rechazaría. Se confirma al salir del campo o con Enter, y se
 * ajusta al rango permitido en vez de tirar un error.
 */
export function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step = 5,
  onCommit,
  readOnly = false,
}: NumberFieldProps) {
  const t = useT();
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);

  // Mientras el host escribe no se pisa lo que tiene a medio tipear; cuando el
  // servidor confirma otro valor (o lo cambia otro dispositivo), el campo se pone al día.
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);

  function commit(raw: string) {
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }

  function nudge(delta: number) {
    const next = clamp(value + delta, min, max);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }

  const inputId = `number-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className={`number-field ${readOnly ? 'number-field--readonly' : ''}`}>
      <label className="number-field__label" htmlFor={inputId}>
        {label}
        {hint && <span className="number-field__hint">{hint}</span>}
      </label>

      <div className="number-field__control">
        <button
          type="button"
          className="number-field__step"
          onClick={() => nudge(-step)}
          disabled={readOnly || value <= min}
          aria-label={t.lobby.minus(step)}
        >
          −
        </button>

        <input
          id={inputId}
          className="number-field__input"
          value={draft}
          inputMode="numeric"
          autoComplete="off"
          disabled={readOnly}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
          onFocus={(e) => {
            editing.current = true;
            e.target.select();
          }}
          onBlur={(e) => {
            editing.current = false;
            commit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(String(value));
              e.currentTarget.blur();
            }
          }}
        />

        <button
          type="button"
          className="number-field__step"
          onClick={() => nudge(step)}
          disabled={readOnly || value >= max}
          aria-label={t.lobby.plus(step)}
        >
          +
        </button>
      </div>
    </div>
  );
}
