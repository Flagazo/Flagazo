import { useAppStore } from '../store/useAppStore';
import { CredentialsForm } from './auth/CredentialsForm';
import { ForgotForm } from './auth/ForgotForm';
import { ResetForm } from './auth/ResetForm';
import { VerifyForm } from './auth/VerifyForm';
import './AuthScreen.css';

/**
 * Todo lo de la cuenta en una pantalla, por pasos:
 *
 *   login ⇄ register → verify → (entra)
 *   login → forgot → reset → (entra)
 *
 * Nada de esto bloquea el juego: "jugar como invitado" vuelve a donde estabas.
 */
export function AuthScreen() {
  const mode = useAppStore((s) => s.authMode);
  const goTo = useAppStore((s) => s.goTo);
  const returnTo = useAppStore((s) => s.authReturnTo);
  const nickname = useAppStore((s) => s.session.nickname);

  function playAsGuest() {
    // Sin nickname todavía, "volver" es elegir uno; con nickname, a donde estaba.
    goTo(nickname ? (returnTo === 'auth' || returnTo === 'nickname' ? 'menu' : returnTo) : 'nickname');
  }

  return (
    // La key reinicia el formulario al cambiar de paso: cada uno arranca limpio.
    <main className="screen auth-screen" key={mode === 'register' ? 'login' : mode}>
      {(mode === 'login' || mode === 'register') && <CredentialsForm onGuest={playAsGuest} />}
      {mode === 'verify' && <VerifyForm />}
      {mode === 'forgot' && <ForgotForm />}
      {mode === 'reset' && <ResetForm />}
    </main>
  );
}
