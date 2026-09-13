import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { logout } from '../net/account';
import { useAppStore } from '../store/useAppStore';
import { AccountAvatar } from './AccountAvatar';
import './AccountMenu.css';

/**
 * La cuenta, arriba a la derecha.
 *
 * Con sesión: avatar y nombre, que abren un menú con el perfil y "Cerrar sesión". Sin sesión:
 * un botón chico para iniciarla en el menú y el buscador, para no ensuciar la
 * pantalla mientras se juega. Si el servidor no tiene cuentas, no se dibuja nada.
 */
export function AccountMenu() {
  const account = useAppStore((s) => s.account);
  const screen = useAppStore((s) => s.screen);
  const inRoom = useAppStore((s) => s.room !== null);
  const openAuth = useAppStore((s) => s.openAuth);
  const goTo = useAppStore((s) => s.goTo);
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!account.loaded || !account.enabled) return null;

  const user = account.user;
  if (!user) {
    // En la pantalla de nickname ya está la invitación grande: no hace falta repetirla.
    if (screen !== 'menu' && screen !== 'browse') return null;
    return (
      <button type="button" className="account-signin" onClick={() => openAuth('login')} aria-label={t.auth.signIn}>
        <span className="account-signin__icon" aria-hidden="true">
          👤
        </span>
        <span className="account-signin__label">{t.auth.signIn}</span>
      </button>
    );
  }

  async function handleLogout() {
    setBusy(true);
    await logout();
    setBusy(false);
    setOpen(false);
  }

  return (
    <div className="account" ref={root}>
      <button
        type="button"
        className="account__chip"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t.auth.account}
      >
        <AccountAvatar seed={user.id} name={user.username} url={user.avatarUrl} size={28} />
        <span className="account__name">{user.username}</span>
      </button>

      {open && (
        <div className="account__menu" role="menu">
          <div className="account__who">
            <strong>{user.username}</strong>
            {user.email && <small>{user.email}</small>}
          </div>
          {/* En una sala no se ofrece: salir al perfil te sacaría de la pantalla de juego. */}
          {!inRoom && (
            <button
              type="button"
              role="menuitem"
              className="account__item"
              onClick={() => {
                setOpen(false);
                goTo('profile');
              }}
            >
              {t.profile.open}
            </button>
          )}
          {!inRoom && (
            <button
              type="button"
              role="menuitem"
              className="account__item"
              onClick={() => {
                setOpen(false);
                goTo('ranking');
              }}
            >
              🏆 {t.ranking.open}
            </button>
          )}
          <button type="button" role="menuitem" className="account__item" onClick={handleLogout} disabled={busy}>
            {t.auth.logout}
          </button>
        </div>
      )}
    </div>
  );
}
