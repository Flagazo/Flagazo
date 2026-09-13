import { useT } from '../i18n';
import { leaveParty } from '../net/party';
import { useAppStore } from '../store/useAppStore';
import { AccountMenu } from './AccountMenu';
import { ConnectionBadge } from './ConnectionBadge';
import { LanguageSelector } from './LanguageSelector';
import { MuteButton } from './MuteButton';
import { Logo } from './Logo';
import './TopBar.css';

interface TopBarProps {
  showLogo?: boolean;
}

export function TopBar({ showLogo = true }: TopBarProps) {
  const inRoom = useAppStore((s) => s.room !== null);
  const goTo = useAppStore((s) => s.goTo);
  const t = useT();

  /*
   * El logo es el "inicio": lleva a crear party o entrar con código.
   *
   * Si estás en una party hay que salir primero, y de eso se entera el store
   * cuando el servidor confirma ('room:left' navega solo). Si no estás en
   * ninguna, se va derecho al menú.
   */
  function goHome() {
    if (inRoom) void leaveParty();
    else goTo('menu');
  }

  return (
    <header className="topbar">
      <div className="topbar__left">
        {showLogo && <Logo size="sm" onClick={goHome} label={t.topbar.home} />}
      </div>
      <div className="topbar__right">
        <LanguageSelector />
        <MuteButton />
        <ConnectionBadge />
        <AccountMenu />
      </div>
    </header>
  );
}
