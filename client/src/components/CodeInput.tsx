import { useRef, useState } from 'react';
import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH, normalizePartyCode } from '@flagazo/shared';
import { useT } from '../i18n';
import './CodeInput.css';

interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  invalid?: boolean;
}

/** Limpia lo escrito o pegado ("x7k-92", "X7 K92") dejando solo caracteres válidos. */
function cleanCode(raw: string): string {
  return [...normalizePartyCode(raw)]
    .filter((char) => PARTY_CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, PARTY_CODE_LENGTH);
}

/**
 * Un único <input> real (bueno para móviles, pegar y accesibilidad)
 * dibujado como casilleros individuales.
 */
export function CodeInput({ value, onChange, onComplete, invalid = false }: CodeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const t = useT();

  const handleChange = (raw: string) => {
    const code = cleanCode(raw);
    onChange(code);
    if (code.length === PARTY_CODE_LENGTH) onComplete?.(code);
  };

  return (
    <label className={`code-input ${invalid ? 'code-input--invalid shake' : ''}`}>
      <span className="visually-hidden">{t.menu.codeLabel}</span>
      <input
        ref={inputRef}
        className="code-input__native"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={PARTY_CODE_LENGTH + 4}
      />
      <span className="code-input__boxes" aria-hidden="true">
        {Array.from({ length: PARTY_CODE_LENGTH }, (_, i) => {
          const char = value[i] ?? '';
          const isActive = focused && i === Math.min(value.length, PARTY_CODE_LENGTH - 1);
          return (
            <span
              key={i}
              className={[
                'code-input__box',
                char ? 'code-input__box--filled' : '',
                isActive ? 'code-input__box--active' : '',
              ].join(' ')}
            >
              {char}
            </span>
          );
        })}
      </span>
    </label>
  );
}
