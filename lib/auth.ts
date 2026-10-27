import { cookies } from "next/headers";
import { sql, toFriendlyDbError } from "@/lib/db";
import {
  DEVICE_COOKIE_NAME,
  deviceCookieOptions,
  isValidDeviceId,
} from "@/lib/device-cookie";

/**
 * Identità SOLO dispositivo (modello HOME-GYM): niente email, niente
 * password, niente AUTH_SECRET. Il browser ha un cookie `euro_device`
 * con un UUID; la prima scrittura crea da sola la riga in
 * public.users (+ profilo via trigger). Il nome visualizzato si cambia
 * in /profilo. Ogni dispositivo ha il suo account; per usare lo stesso
 * su due dispositivi basta importare l'ID in /profilo.
 *
 * Nome, validazione e attributi del cookie stanno in lib/device-cookie.ts:
 * lo stesso modulo è usato da proxy.ts, che assegna il cookie alla prima
 * richiesta (qui sarebbe illegale durante il render).
 */

export { isValidDeviceId };

/** Legge l'ID dispositivo dal cookie. MAI throw (null = dispositivo nuovo). */
export async function getDeviceUserId(): Promise<string | null> {
  try {
    const store = await cookies();
    const raw = store.get(DEVICE_COOKIE_NAME)?.value;
    return isValidDeviceId(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Scrive il cookie di identità. Next consente la modifica dei cookie solo in
 * un Server Action o in un Route Handler: durante il render lo assegna già
 * proxy.ts PRIMA del render stesso, quindi un rifiuto qui non è fatale (la
 * richiesta in corso usa comunque l'ID generato) e non deve diventare un
 * errore "database non disponibile" mostrato all'utente.
 */
async function writeDeviceCookie(id: string): Promise<void> {
  try {
    const store = await cookies();
    store.set(DEVICE_COOKIE_NAME, id, deviceCookieOptions());
  } catch (e) {
    console.warn(
      "[auth] cookie dispositivo non scrivibile in questo contesto (lo assegna proxy.ts):",
      e instanceof Error ? e.message : e
    );
  }
}

/** Crea la riga utente se manca (idempotente) e imposta il cookie. */
async function provisionDeviceUser(id: string): Promise<void> {
  await sql()`INSERT INTO public.users (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING`;
  await writeDeviceCookie(id);
}

/**
 * ID dispositivo garantito: se il cookie manca o è invalido, crea un
 * nuovo account e lo imposta. Usato dalle pagine personali e da tutte
 * le action di scrittura. Lancia solo se il DB è davvero giù (mai-throw
 * gestito dai chiamanti con toActionError / fallback vuoto).
 */
export async function ensureDeviceUserId(): Promise<string> {
  const existing = await getDeviceUserId();
  if (existing) {
    try {
      await sql()`INSERT INTO public.users (id) VALUES (${existing}) ON CONFLICT (id) DO NOTHING`;
    } catch (e) {
      throw toFriendlyDbError(e, "Database non disponibile, riprova tra poco.");
    }
    return existing;
  }
  const fresh = crypto.randomUUID();
  try {
    await provisionDeviceUser(fresh);
  } catch (e) {
    throw toFriendlyDbError(e, "Database non disponibile, riprova tra poco.");
  }
  return fresh;
}

/**
 * Collega questo browser a un account esistente (ID copiato da un altro
 * dispositivo). Ritorna false se l'ID non è un UUID valido.
 */
export async function adoptDeviceId(id: string): Promise<boolean> {
  if (!isValidDeviceId(id)) return false;
  try {
    await provisionDeviceUser(id);
    return true;
  } catch {
    return false;
  }
}
