import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/lilita-one';
import '@fontsource-variable/nunito';
import './styles/theme.css';
import './styles/global.css';
import { App } from './App';
import { initConnection } from './net/connection';
import { initAudioUnlock } from './audio/SoundManager';

initConnection();
// El audio se habilita en el primer gesto: los navegadores lo bloquean antes.
initAudioUnlock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
