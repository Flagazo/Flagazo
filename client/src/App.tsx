import { FlagBackground } from './components/FlagBackground';
import { Toaster } from './components/Toaster';
import { TopBar } from './components/TopBar';
import { BrowseScreen } from './screens/BrowseScreen';
import { GameScreen } from './screens/GameScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { MenuScreen } from './screens/MenuScreen';
import { NicknameScreen } from './screens/NicknameScreen';
import { useAppStore } from './store/useAppStore';

/**
 * Navegación por estado (sin router): el juego tiene pocas pantallas y
 * es el servidor quien decide en cuál estás (lobby, partida, resultados…).
 */
export function App() {
  const screen = useAppStore((s) => s.screen);

  return (
    <div className="app">
      <FlagBackground />
      <TopBar showLogo={screen !== 'nickname'} />
      {screen === 'nickname' && <NicknameScreen />}
      {screen === 'menu' && <MenuScreen />}
      {screen === 'browse' && <BrowseScreen />}
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'game' && <GameScreen />}
      <Toaster />
    </div>
  );
}
