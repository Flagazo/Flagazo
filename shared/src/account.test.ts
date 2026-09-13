import { describe, expect, it } from 'vitest';
import { emailKey, validateEmail, validatePassword, validateUsername } from './account';

describe('validateUsername', () => {
  it('sigue las reglas del nickname', () => {
    expect(validateUsername('Martín_99')).toEqual({ ok: true, value: 'Martín_99' });
    expect(validateUsername('  Ana   Paula ')).toEqual({ ok: true, value: 'Ana Paula' });
    expect(validateUsername('a')).toEqual({ ok: false, error: 'TOO_SHORT' });
    expect(validateUsername('x'.repeat(17))).toEqual({ ok: false, error: 'TOO_LONG' });
    expect(validateUsername('<script>')).toEqual({ ok: false, error: 'INVALID_CHARS' });
    expect(validateUsername(42)).toEqual({ ok: false, error: 'EMPTY' });
  });
});

describe('validateEmail', () => {
  it('acepta direcciones reales, incluidas las raras', () => {
    for (const email of ['ana@example.com', 'ana.paula+flagazo@mail.co.uk', 'x@sub.dominio.io']) {
      expect(validateEmail(email)).toEqual({ ok: true, value: email });
    }
    expect(validateEmail('  ana@example.com ')).toEqual({ ok: true, value: 'ana@example.com' });
  });

  it('rechaza lo que no tiene forma de email', () => {
    for (const email of ['ana', 'ana@', '@example.com', 'ana@example', 'ana @example.com', 'a@b..com']) {
      expect(validateEmail(email), email).toEqual({ ok: false, error: 'EMAIL_INVALID' });
    }
    expect(validateEmail('')).toEqual({ ok: false, error: 'EMAIL_EMPTY' });
    expect(validateEmail(`${'a'.repeat(250)}@x.com`)).toEqual({ ok: false, error: 'EMAIL_INVALID' });
  });

  it('la clave ignora mayúsculas y espacios', () => {
    expect(emailKey('  Ana@Example.COM ')).toBe('ana@example.com');
  });
});

describe('validatePassword', () => {
  it('pide largo, no composición', () => {
    expect(validatePassword('caballo bateria')).toEqual({ ok: true, value: 'caballo bateria' });
    expect(validatePassword('1234567')).toEqual({ ok: false, error: 'PASSWORD_TOO_SHORT' });
    expect(validatePassword('x'.repeat(129))).toEqual({ ok: false, error: 'PASSWORD_TOO_LONG' });
  });

  it('cuenta caracteres, no bytes: 4 banderas emoji son 8', () => {
    expect(validatePassword('🇦🇷🇧🇷🇨🇱🇺🇾').ok).toBe(true);
  });

  it('no deja usar el email, su parte local ni el username', () => {
    const account = { email: 'martina@example.com', username: 'Martinaaa' };
    expect(validatePassword('MARTINA@example.com', account)).toEqual({ ok: false, error: 'PASSWORD_LIKE_ACCOUNT' });
    expect(validatePassword('martinaaa', account)).toEqual({ ok: false, error: 'PASSWORD_LIKE_ACCOUNT' });
    expect(validatePassword('martina1234', account).ok).toBe(true);
  });
});
