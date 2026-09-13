import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/lilita-one';
import '@fontsource-variable/nunito';
import './styles/theme.css';
import './styles/global.css';
import { App } from './App';
import { loadAccount } from './net/account';
import { initConnection } from './net/connection';
import { initAudioUnlock } from './audio/SoundManager';

initConnection();
// En paralelo con el socket: el juego como invitado no espera a saber si hay cuenta.
void loadAccount();
// El audio se habilita en el primer gesto: los navegadores lo bloquean antes.
initAudioUnlock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
