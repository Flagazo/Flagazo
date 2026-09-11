import './OptionGroup.css';

export interface Option<T> {
  value: T;
  label: string;
  /** Elegible en teoría, pero no con la configuración actual (ej.: pasa el tope). */
  disabled?: boolean;
  /** Por qué no se puede elegir. Aparece al pasar el mouse. */
  disabledReason?: string;
}

interface OptionGroupProps<T> {
  label: string;
  hint?: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  /** Los que no son host ven la configuración, pero no pueden tocarla. */
  readOnly?: boolean;
}

/**
 * Selector de una opción entre pocas (dificultad, rondas, segundos…).
 * Es un grupo de radios real: funciona con teclado y lectores de pantalla,
 * aunque se dibuje como botones.
 */
export function OptionGroup<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
  readOnly = false,
}: OptionGroupProps<T>) {
  return (
    <fieldset className={`option-group ${readOnly ? 'option-group--readonly' : ''}`}>
      <legend className="option-group__label">
        {label}
        {hint && <span className="option-group__hint">{hint}</span>}
      </legend>
      <div className="option-group__options">
        {options.map((option) => {
          const selected = option.value === value;
          // Lo ya elegido nunca se deshabilita: sacaría el marcador de la pantalla.
          const blocked = Boolean(option.disabled) && !selected;
          return (
            <label
              key={String(option.value)}
              className={[
                'option',
                selected ? 'option--selected' : '',
                blocked ? 'option--blocked' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={blocked ? option.disabledReason : undefined}
            >
              <input
                type="radio"
                className="visually-hidden"
                name={label}
                checked={selected}
                disabled={readOnly || blocked}
                onChange={() => onChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
