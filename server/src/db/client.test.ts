import { describe, expect, it } from 'vitest';
import { verifyFullSsl } from './client';

describe('verifyFullSsl', () => {
  it('pide verify-full explícito cuando la URL trae require, como la entrega Neon', () => {
    const url = 'postgresql://usuario:clave@ep-algo.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
    const fixed = new URL(verifyFullSsl(url));
    expect(fixed.searchParams.get('sslmode')).toBe('verify-full');
    expect(fixed.searchParams.get('channel_binding')).toBe('require');
    expect(fixed.username).toBe('usuario');
    expect(fixed.password).toBe('clave');
    expect(fixed.host).toBe('ep-algo.us-east-2.aws.neon.tech');
  });

  it('no toca URLs sin sslmode, con verify-full, disable o con uselibpqcompat', () => {
    for (const url of [
      'postgresql://u:c@localhost:5432/db',
      'postgresql://u:c@host/db?sslmode=verify-full',
      'postgresql://u:c@host/db?sslmode=disable',
      'postgresql://u:c@host/db?uselibpqcompat=true&sslmode=require',
      'esto no es una url',
    ]) {
      expect(verifyFullSsl(url)).toBe(url);
    }
  });
});
