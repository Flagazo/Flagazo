import { AUTH_CODE } from '@flagazo/shared';
import type { EmailLocale } from '@flagazo/shared';
import type { EmailMessage } from './mailer';

/**
 * Los emails de las cuentas.
 *
 * HTML con tablas y estilos en línea, sin imágenes ni fuentes externas: es lo que
 * se ve igual en Gmail, Outlook y el Mail del celular, y no dispara los filtros
 * de spam que se activan con imágenes remotas. Siempre va también en texto plano.
 */

const MINUTES = Math.round(AUTH_CODE.ttlMs / 60_000);

const COPY = {
  es: {
    verify: {
      subject: (code: string) => `${code} es tu código de Flagazo`,
      title: 'Tu código de verificación es:',
      expires: `Este código vence en ${MINUTES} minutos.`,
      ignore: 'Si no creaste una cuenta en Flagazo, puedes ignorar este mensaje.',
    },
    reset: {
      subject: (code: string) => `${code} es tu código para cambiar la contraseña`,
      title: 'Tu código para elegir una contraseña nueva es:',
      expires: `Este código vence en ${MINUTES} minutos.`,
      ignore: 'Si no pediste cambiar tu contraseña, ignora este mensaje: tu contraseña actual sigue igual.',
    },
    exists: {
      subject: 'Ya tienes una cuenta en Flagazo',
      title: 'Alguien intentó crear una cuenta en Flagazo con este email.',
      body: 'Si fuiste tú: ya tienes una cuenta. Inicia sesión, o usa "¿Olvidaste tu contraseña?" si no la recuerdas.',
      ignore: 'Si no fuiste tú, puedes ignorar este mensaje. Nadie puede entrar a tu cuenta sin tu contraseña.',
    },
    footer: 'Flagazo · El juego de banderas con amigos · flagazo.com',
  },
  en: {
    verify: {
      subject: (code: string) => `${code} is your Flagazo code`,
      title: 'Your verification code is:',
      expires: `This code expires in ${MINUTES} minutes.`,
      ignore: 'If you did not create a Flagazo account, you can ignore this email.',
    },
    reset: {
      subject: (code: string) => `${code} is your code to reset your password`,
      title: 'Your code to choose a new password is:',
      expires: `This code expires in ${MINUTES} minutes.`,
      ignore: 'If you did not ask to reset your password, ignore this email: your current password still works.',
    },
    exists: {
      subject: 'You already have a Flagazo account',
      title: 'Someone tried to create a Flagazo account with this email.',
      body: 'If it was you: you already have an account. Log in, or use "Forgot your password?" if you do not remember it.',
      ignore: 'If it was not you, you can ignore this email. Nobody can get into your account without your password.',
    },
    footer: 'Flagazo · The flag party game · flagazo.com',
  },
} as const;

export function verificationEmail(to: string, code: string, locale: EmailLocale): EmailMessage {
  const copy = COPY[locale].verify;
  return codeEmail('verify_email', to, code, locale, copy);
}

export function passwordResetEmail(to: string, code: string, locale: EmailLocale): EmailMessage {
  const copy = COPY[locale].reset;
  return codeEmail('reset_password', to, code, locale, copy);
}

/** Para quien se intenta registrar con un email que ya tiene cuenta. Sin código. */
export function accountExistsEmail(to: string, locale: EmailLocale): EmailMessage {
  const copy = COPY[locale].exists;
  const footer = COPY[locale].footer;
  return {
    kind: 'account_exists',
    to,
    subject: copy.subject,
    text: `FLAGAZO\n\n${copy.title}\n\n${copy.body}\n\n${copy.ignore}\n\n${footer}`,
    html: layout(
      locale,
      `
      <p style="margin:0 0 14px;font-size:18px;font-weight:700;color:#101722;">${escape(copy.title)}</p>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#101722;">${escape(copy.body)}</p>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#5b6475;">${escape(copy.ignore)}</p>`,
      footer,
    ),
  };
}

function codeEmail(
  kind: 'verify_email' | 'reset_password',
  to: string,
  code: string,
  locale: EmailLocale,
  copy: { subject: (code: string) => string; title: string; expires: string; ignore: string },
): EmailMessage {
  const footer = COPY[locale].footer;
  return {
    kind,
    to,
    subject: copy.subject(code),
    text: `FLAGAZO\n\n${copy.title}\n\n${code}\n\n${copy.expires}\n\n${copy.ignore}\n\n${footer}`,
    html: layout(
      locale,
      `
      <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#101722;">${escape(copy.title)}</p>
      <p style="margin:0 0 12px;padding:18px 0;border-radius:14px;background:#fff4d6;text-align:center;font-family:'Courier New',Courier,monospace;font-size:40px;font-weight:700;letter-spacing:10px;color:#101722;">${escape(code)}</p>
      <p style="margin:0 0 14px;font-size:15px;color:#101722;">${escape(copy.expires)}</p>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#5b6475;">${escape(copy.ignore)}</p>`,
      footer,
    ),
  };
}

function layout(locale: EmailLocale, body: string, footer: string): string {
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#eef1f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr><td style="background:#0a0f1a;padding:22px 28px;">
          <span style="font-size:28px;font-weight:900;letter-spacing:2px;color:#ffc93c;">FLAG</span><span style="font-size:28px;font-weight:900;letter-spacing:2px;color:#ff4f8b;">AZO</span>
        </td></tr>
        <tr><td style="padding:28px;">${body}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e3e7ee;font-size:12px;color:#8a93a3;">${escape(footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
