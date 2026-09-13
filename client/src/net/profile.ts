import { AVATAR } from '@flagazo/shared';
import type { AccountInfo, DeleteAccountRequest, OAuthProvider } from '@flagazo/shared';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { apiRequest } from './api';
import type { ClientApiResult } from './api';
import { refreshAccountOnServer, signOutOnServer } from './connection';

type AccountResult = ClientApiResult<{ account: AccountInfo }>;

/**
 * Guarda la cuenta que devolvió el servidor, si salió bien, y le avisa al servidor
 * de juego para que el nombre y la foto nuevos se vean en la sala.
 */
function keep(result: AccountResult): AccountResult {
  if (result.ok) {
    useAppStore.getState().setAccount({ user: result.data.account });
    void refreshAccountOnServer();
  }
  return result;
}

export async function changeUsername(username: string): Promise<AccountResult> {
  return keep(await apiRequest<{ account: AccountInfo }>('/me', { username }, { method: 'PATCH' }));
}

/**
 * Borra la cuenta para siempre. Si sale bien, se sigue jugando como invitado con
 * el mismo nombre: el servidor ya sacó la cuenta de la sala, y esto lo repite por
 * si el aviso se perdió.
 */
export async function deleteAccount(request: DeleteAccountRequest): Promise<ClientApiResult<null>> {
  const result = await apiRequest<null>('/me/delete', request);
  if (result.ok) {
    const store = useAppStore.getState();
    store.setAccount({ user: null });
    await signOutOnServer();
    store.pushToast(t().profile.deleted, 'info');
    store.goTo(store.room ? (store.room.game ? 'game' : 'lobby') : 'menu');
  }
  return result;
}

/** Errores que se detectan antes de subir: el servidor igual vuelve a validar todo. */
export type AvatarPrepareError = 'AVATAR_INVALID';

export async function uploadAvatar(file: File): Promise<AccountResult | { ok: false; error: AvatarPrepareError }> {
  const blob = await prepareAvatar(file);
  if (!blob) return { ok: false, error: 'AVATAR_INVALID' };
  return keep(await apiRequest<{ account: AccountInfo }>('/me/avatar', undefined, { method: 'POST', blob }));
}

export async function applyProviderAvatar(provider: OAuthProvider): Promise<AccountResult> {
  return keep(await apiRequest<{ account: AccountInfo }>('/me/avatar/provider', { provider }));
}

export async function removeAvatar(): Promise<AccountResult> {
  return keep(await apiRequest<{ account: AccountInfo }>('/me/avatar', undefined, { method: 'DELETE' }));
}

/**
 * Achica la foto en el navegador antes de subirla.
 *
 * Una foto de celular pesa 3–8 MB y el servidor acepta 2 MB; además la guarda en
 * 256×256, así que subir la original es tiempo y datos móviles tirados. Se deja
 * en 512 px del lado corto, que sobra para recortar bien. null si el navegador
 * no la puede abrir: no es una imagen, o no es JPG, PNG o WebP.
 */
async function prepareAvatar(file: File): Promise<Blob | null> {
  if (!AVATAR.types.includes(file.type)) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }

  const scale = Math.min(1, 512 / Math.min(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return file.size <= AVATAR.maxUploadBytes ? file : null;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  // Safari viejo no sabe generar WebP y devuelve PNG: en ese caso, JPG.
  const webp = await encode('image/webp');
  const blob = webp?.type === 'image/webp' ? webp : await encode('image/jpeg');
  return blob && blob.size <= AVATAR.maxUploadBytes ? blob : null;
}
