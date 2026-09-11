import { useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import './ConnectionBadge.css';

export function ConnectionBadge() {
  const { status, pingMs, online } = useAppStore((s) => s.connection);
  const t = useT();
  const isConnected = status === 'connected';

  return (
    <div className={`conn conn--${status}`} role="status" aria-live="polite">
      <span className="conn__dot" aria-hidden="true" />
      <span className="conn__label">{t.topbar.connection[status]}</span>
      {isConnected && (
        <>
          <span className="conn__sep" aria-hidden="true" />
          <span className="conn__stat" title={t.topbar.playersOnline}>
            <span aria-hidden="true">👥</span> {online}
          </span>
          {pingMs !== null && (
            <span className="conn__stat conn__ping" title={t.topbar.latency}>
              {pingMs} ms
            </span>
          )}
        </>
      )}
    </div>
  );
}
