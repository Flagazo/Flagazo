import { LOCALES, useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import './LanguageSelector.css';

/**
 * Selector de idioma de la interfaz.
 *
 * Con dos idiomas conviene un par de botones a la vista y no un desplegable:
 * se cambia de un toque y siempre se ve en cuál estás. Si algún día son más,
 * esto tiene que pasar a ser un menú.
 */
export function LanguageSelector() {
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const t = useT();

  return (
    <div className="lang" role="group" aria-label={t.topbar.language}>
      {LOCALES.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`lang__option ${option.id === locale ? 'lang__option--active' : ''}`}
          onClick={() => setLocale(option.id)}
          aria-pressed={option.id === locale}
          title={option.label}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}
