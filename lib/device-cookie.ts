/**
 * Cookie di identità del dispositivo: nome, opzioni e validazione in un
 * modulo SENZA dipendenze.
 *
 * Perché esiste: lo assegna alla prima richiesta `proxy.ts` (dove è
 * consentito scrivere cookie) e lo legge `lib/auth.ts` durante il render.
 * Se la definizione stesse in lib/auth.ts, proxy.ts si porterebbe dietro
 * `next/headers` e il driver Neon senza motivo.
 */

export const DEVICE_COOKIE_NAME = "euro_device";

// 400 giorni (max pratico per i cookie persistenti).
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Attributi comuni al cookie, sia in proxy.ts sia nelle Server Action. */
export function deviceCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  };
}
