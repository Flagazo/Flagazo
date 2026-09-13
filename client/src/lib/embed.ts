/**
 * Si el juego corre dentro de otra página (la de itch.io, por ejemplo).
 *
 * Ahí las cuentas no pueden funcionar: el navegador no guarda la cookie de
 * sesión de un sitio metido en otro, y Google no deja iniciar sesión dentro de
 * un iframe. Se juega como invitado y, para la cuenta, se ofrece abrir el sitio.
 */
export const embedded: boolean = (() => {
  try {
    return window.self !== window.top;
  } catch {
    // Acceder a window.top desde otro origen puede tirar error: eso ya es estar embebido.
    return true;
  }
})();
