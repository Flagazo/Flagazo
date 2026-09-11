/// <reference types="vite/client" />

/**
 * Variables de entorno del cliente.
 *
 * Todas opcionales: sin ellas el juego funciona igual, solo que sin publicidad.
 * Van por entorno y no en el código porque la cuenta y los ids cambian según
 * quién despliegue, y no tienen por qué estar en el repositorio.
 */
interface ImportMetaEnv {
  /** Id de editor de la red (AdSense: `ca-pub-…`). Sin esto no hay publicidad. */
  readonly VITE_ADS_CLIENT?: string;
  /** Id del bloque del lobby. */
  readonly VITE_ADS_SLOT_LOBBY?: string;
  /** Id del bloque de la pantalla final. */
  readonly VITE_ADS_SLOT_RESULTS?: string;
  /**
   * A dónde lleva el botón de donar. Sirve cualquier plataforma: Cafecito,
   * Ko-fi, PayPal, Mercado Pago. Sin esto el botón no aparece.
   */
  readonly VITE_DONATE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
