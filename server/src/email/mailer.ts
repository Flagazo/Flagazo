import { createLogger } from '../lib/log';

const log = createLogger('email');

export interface EmailMessage {
  /** Qué email es. Solo para los logs: el asunto no se loggea porque lleva el código. */
  kind: 'verify_email' | 'reset_password' | 'account_exists';
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Envío por la API HTTP de Resend.
 *
 * Es HTTPS y no SMTP a propósito: el plan gratis de Render bloquea los puertos
 * de SMTP (25, 465 y 587), así que ni Gmail ni ningún servidor de correo se
 * pueden usar directo desde ahí. El remitente sigue siendo flagazo@flagazo.com,
 * con el dominio verificado en Resend.
 */
export class ResendMailer implements Mailer {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo: string | null = null,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // El cuerpo del error de Resend dice qué pasó (dominio sin verificar, clave
      // inválida…) y no trae datos del mensaje: se puede loggear.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Resend respondió ${response.status}: ${detail}`);
    }
  }
}

/**
 * Solo para desarrollo: el email se escribe en la consola del servidor en vez de
 * mandarse. Así se prueba el registro sin configurar nada y sin gastar envíos.
 */
export class ConsoleMailer implements Mailer {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    log.info(`📧 (no se envía, modo desarrollo) para ${message.to} · ${message.subject}\n${message.text}\n`);
  }
}

/** Para los tests: guarda los mensajes en una lista. */
export class MemoryMailer implements Mailer {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];
  fail = false;

  async send(message: EmailMessage): Promise<void> {
    if (this.fail) throw new Error('Envío fallido (simulado)');
    this.sent.push(message);
  }

  /** El último mensaje que recibió esta dirección. */
  lastTo(to: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === to);
  }
}

/**
 * Manda sin hacer esperar a quien pidió.
 *
 * Así el registro tarda lo mismo con un email nuevo (se manda un código) que con
 * uno que ya tiene cuenta (se manda un aviso, o nada si ya se avisó hace poco),
 * y un Resend lento no deja al jugador mirando un botón que no responde. Si el
 * envío falla, el usuario puede pedir otro código.
 */
export function sendInBackground(mailer: Mailer, message: EmailMessage) {
  mailer.send(message).catch((error: unknown) => {
    // Ni el asunto ni el texto ni el destinatario: el código va en los dos primeros.
    log.error(`No se pudo enviar un email (${message.kind})`, error instanceof Error ? error.message : error);
  });
}
