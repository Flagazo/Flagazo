const AVATAR_COLORS = ['#ff4f8b', '#ffc93c', '#35d6ff', '#2ee59d', '#b78cff', '#ff8a3d'];

/** Color estable para un jugador a partir de su id o nickname. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export function avatarInitial(nickname: string): string {
  return [...nickname.trim()][0]?.toUpperCase() ?? '?';
}
