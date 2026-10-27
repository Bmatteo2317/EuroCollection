import { neon } from "@neondatabase/serverless";

// NOTA: `neonConfig.fetchConnectionCache` non va impostato. Il driver lo
// mantiene solo per compatibilità — è sempre attivo — e impostarlo stampa un
// avviso di deprecazione a ogni import.

export type Sql = ReturnType<typeof neon>;

/**
 * Client SQL Neon. Legge la prima connection string disponibile tra quelle
 * create dall'integrazione Neon ↔ Vercel (pooled preferite).
 * Creato lazy così le pagine guest / build senza env non crashano.
 *
 * NOTA Vercel + Neon: l'integrazione Neon su Vercel inietta
 * DATABASE_URL / POSTGRES_URL (pooled) + varianti _UNPOOLED / _NON_POOLING.
 * Se il deploy mostra "Minified React error #441", la causa reale è quasi
 * sempre qui (env mancante) o schema non eseguito: il digest nei Function
 * Log di Vercel contiene il messaggio originale.
 */
let cached: Sql | null = null;
let cachedKey: string | null = null;

const CANDIDATES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "NEON_DATABASE_URL",
  "NEON_POSTGRES_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NO_SSL",
  "POSTGRES_PRISMA_URL",
] as const;

export const DB_ENV_KEYS: readonly string[] = CANDIDATES;

function findConnectionString(): { key: string; value: string } | null {
  for (const k of CANDIDATES) {
    const v = process.env[k];
    if (typeof v === "string" && v.trim().length > 0) {
      return { key: k, value: v.trim() };
    }
  }
  return null;
}

/** true se esiste almeno una connection string (non dice se è valida). */
export function isDbConfigured(): boolean {
  return findConnectionString() !== null;
}

export const MISSING_ENV_MESSAGE =
  "Database non configurato: su Vercel apri Project → Storage (Neon) e verifica che le Environment Variables (DATABASE_URL) siano presenti per l'ambiente Production, poi fai Redeploy. In locale usa .env.local con DATABASE_URL.";

export function sql(): Sql {
  if (cached && cachedKey) {
    // Se le env sono cambiate (test), ricrea il client.
    const current = findConnectionString();
    if (current && current.key === cachedKey) return cached;
    cached = null;
    cachedKey = null;
  }
  const found = findConnectionString();
  if (!found) {
    throw new Error(MISSING_ENV_MESSAGE);
  }
  cached = neon(found.value);
  cachedKey = found.key;
  return cached;
}

/** Errore Postgres "tabella inesistente" (42P01): schema non eseguito. */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "42P01") return true;
  return typeof message === "string" && /relation .* does not exist/i.test(message);
}

export const MISSING_TABLES_MESSAGE =
  "Manca lo schema su Neon: esegui neon/schema.sql nel SQL Editor di Neon.";

/** true se l'errore è "env mancante" generato da sql(). */
export function isMissingEnvError(error: unknown): boolean {
  return error instanceof Error && error.message === MISSING_ENV_MESSAGE;
}

/** true per errori di rete/TLS/timeout verso Neon (progetto in pausa, URL errato…). */
export function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { message, code } = error as { message?: unknown; code?: unknown };
  if (
    typeof code === "string" &&
    ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"].includes(code)
  ) {
    return true;
  }
  if (typeof message !== "string") return false;
  return /fetch failed|network|timeout|timed out|connection|econn|enotfound|ssl|neon/i.test(
    message
  );
}

export const NEON_UNREACHABLE_MESSAGE =
  "Neon non raggiungibile: controlla che il progetto Neon sia attivo (non in pausa) e che la connection string su Vercel sia quella pooled con ?sslmode=require, poi fai Redeploy.";

/** Dettaglio tecnico grezzo (troncato) da mostrare per la diagnosi. */
function techDetail(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim().slice(0, 220);
  return t && !/Minified React error|#441/i.test(t) ? ` Dettaglio tecnico: ${t}` : "";
}

/**
 * Esegue un'action mai-throw con retry automatici sui soli errori di
 * connessione. Perché: Neon in idle mette in pausa il compute e le prime
 * query al risveglio spesso falliscono (fetch failed/timeout) mentre le
 * successive — a compute sveglio — riescono.
 * Il retry scatta SOLO su errori di connessione (non su errori logici
 * come NOT_OWNED o UNAUTHENTICATED, che non vengono ripetuti).
 */
export async function runWriteAction<T extends object>(
  fn: () => Promise<
    ({ ok: true } & T) | { ok: false; error: string }
  >
): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  const first = await fn();
  if (first.ok || !first.error.startsWith(NEON_UNREACHABLE_MESSAGE)) return first;
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.warn(`[db] errore connessione, retry ${attempt}/2 tra 2.5s…`);
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fn();
    if (res.ok || !res.error.startsWith(NEON_UNREACHABLE_MESSAGE)) return res;
    if (attempt === 2) return res;
  }
  return first;
}

/**
 * Converte QUALSIASI errore lanciato dentro una Server Action in un testo
 * leggibile da mettere in `{ ok: false, error }` (mai rilanciare: in
 * produzione il lancio diventa "Minified React error #441").
 * I codici curati brevi (UNAUTHENTICATED, NOT_OWNED…) passano invariati
 * perché il client li traduce con contesto; gli errori infra diventano
 * messaggi italiani stabili; tutto il resto è un fallback generico
 * (l'originale finisce nei Function Logs via console.error).
 */
export function toActionError(e: unknown): string {
  const raw =
    e instanceof Error && e.message ? e.message : "Operazione non riuscita.";
  const digest =
    e instanceof Error && typeof (e as { digest?: unknown }).digest === "string"
      ? ((e as { digest?: string }).digest as string)
      : null;
  if (/Minified React error|#441/i.test(raw)) {
    return digest
      ? `Il server non ha completato l'operazione (codice ${digest}). Apri /api/health per la diagnosi del database e controlla i Function Logs su Vercel.`
      : "Il server non ha completato l'operazione: apri /api/health per la diagnosi del database e riprova.";
  }
  if (isMissingEnvError(e)) return MISSING_ENV_MESSAGE;
  if (isMissingTableError(e)) {
    const rawMsg = e instanceof Error ? e.message : "";
    return `${MISSING_TABLES_MESSAGE}${techDetail(rawMsg)}`;
  }
  // Prima i messaggi già convertiti (contengono "neon" e ingannerebbero
  // il controllo di connessione qui sotto): mai riclassificarli.
  if (
    raw === MISSING_TABLES_MESSAGE ||
    raw === MISSING_ENV_MESSAGE ||
    raw.startsWith(MISSING_TABLES_MESSAGE) ||
    raw.startsWith(MISSING_ENV_MESSAGE) ||
    raw.startsWith(NEON_UNREACHABLE_MESSAGE)
  ) {
    return raw;
  }
  if (isConnectionError(e)) {
    return `${NEON_UNREACHABLE_MESSAGE}${techDetail(raw)}`;
  }
  // Codici curati (il client li mappa con contesto): invariati.
  if (/^[A-Z_]+$/.test(raw)) return digest ? `${raw} (codice: ${digest})` : raw;
  if (e instanceof Error) {
    console.error("[db] errore action:", e);
  } else {
    console.error("[db] errore action non-Error:", e);
  }
  return `Operazione non riuscita: database non disponibile, riprova tra poco.${techDetail(raw)}`;
}

/**
 * Converte QUALSIASI errore DB in un Error con messaggio stabile e
 * serializzabile. Fondamentale: in produzione gli errori grezzi delle
 * Server Action arrivano al client come "Minified React error #441"
 * (solo digest), mentre questi messaggi restano leggibili.
 */
export function toFriendlyDbError(error: unknown, fallback: string): Error {
  if (isMissingEnvError(error)) return new Error(MISSING_ENV_MESSAGE);
  if (isMissingTableError(error)) return new Error(MISSING_TABLES_MESSAGE);
  if (isConnectionError(error)) {
    const raw = error instanceof Error ? error.message : "";
    return new Error(`${NEON_UNREACHABLE_MESSAGE}${techDetail(raw)}`);
  }
  if (error instanceof Error && error.message) {
    // Messaggi già curati dal nostro codice (VALIDATION, NOT_OWNED…).
    if (
      /^(UNAUTHENTICATED|NOT_OWNED|NOT_FOUND|FORBIDDEN|STATE|SELF|INVALID_YEAR|OFFER_UNAVAILABLE)/.test(
        error.message
      )
    ) {
      return error;
    }
    // Fallback + dettaglio tecnico grezzo (troncato): serve per diagnosticare
    // senza accesso ai Function Logs (l'originale resta anche nei log).
    console.error("[db] errore Neon:", error);
    return new Error(`${fallback}${techDetail(error.message)}`);
  }
  console.error("[db] errore Neon non-Error:", error);
  return new Error(fallback);
}
