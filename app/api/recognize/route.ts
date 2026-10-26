import { NextResponse } from "next/server";
import {
  matchVisionCandidates,
  parseVisionOutput,
  type VisionCandidate,
} from "@/lib/recognition";
import type { RecognizeResponse } from "@/lib/recognized";

/**
 * Riconoscimento di una moneta euro da due foto (fronte nazionale + retro
 * comune). Le immagini arrivano dal browser come data URL già ridimensionati;
 * qui vengono inoltrate a un modello vision OpenAI-compatibile e la risposta
 * testuale viene confrontata con il catalogo BCE (vedi lib/recognition.ts).
 *
 * La chiave resta SOLO sul server: il browser non vede mai OPENAI_API_KEY.
 * Senza chiave l'endpoint risponde 503 e la UI propone la ricerca manuale.
 */

export const maxDuration = 60;

const DEFAULT_BASE_URL = "https://freebuff.com/api/v1/paid";
const DEFAULT_MODEL = "gpt-4o-mini";

const MAX_IMAGE_CHARS = 2_800_000;
const DATA_URL_RE = /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/;

// Limite morbido per istanza: evita che un endpoint pubblico con una chiave
// a pagamento venga usato come proxy illimitato. Su serverless il conteggio
// è per istanza, quindi è una protezione best-effort, non una quota.
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 12;
const rateHits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (rateHits.get(key) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  if (recent.length >= RATE_MAX) {
    rateHits.set(key, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(key, recent);
  if (rateHits.size > 500) {
    for (const [k, hits] of rateHits) {
      if (hits.every((t) => now - t >= RATE_WINDOW_MS)) rateHits.delete(k);
    }
  }
  return false;
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

function fail(
  status: number,
  code: string,
  error: string
): NextResponse<RecognizeResponse> {
  return NextResponse.json({ ok: false, code, error }, { status });
}

function isDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_IMAGE_CHARS &&
    DATA_URL_RE.test(value)
  );
}

const SYSTEM_PROMPT = `Sei un esperto numismatico europeo. Ricevi due foto della STESSA moneta euro:
- Foto 1 = FRONTE, cioè il lato nazionale (il disegno del paese emittente; di solito riporta l'anno e, per i 2 € commemorativi, il tema celebrato).
- Foto 2 = RETRO, cioè il lato comune (mappa dell'Europa e valore nominale), identico in tutti i paesi.

Identifica la moneta e rispondi SOLO con un oggetto JSON valido, senza testo attorno:
{"candidates":[{"country":"it","denomination":"2euro","year":2004,"type":"regular","description":"breve descrizione del disegno o del tema","confidence":0.82}]}

Regole:
- "country": codice ISO alpha-2 minuscolo del paese emittente tra at, be, bg, cy, de, ee, es, fi, fr, gr, hr, ie, it, lt, lu, lv, mt, nl, pt, si, sk, va, sm, mc, ad. La Grecia è "gr".
- "denomination": uno tra "2euro", "1euro", "50cent", "20cent", "10cent", "5cent", "2cent", "1cent".
- "year": l'anno a 4 cifre impresso sul lato nazionale, se leggibile; altrimenti null. Per le divisionali è l'anno di conio e può essere successivo all'anno del disegno.
- "type": "commemorative" per i 2 € commemorativi, "regular" per le monete divisionali.
- "description": in italiano, pochi termini utili a distinguere il disegno (es. "Torino Olimpiadi", "albero", "aquila"). Per i commemorativi indica il tema.
- "confidence": numero tra 0 e 1.
- Metti al massimo 3 candidati, dal più probabile al meno probabile, senza duplicati. Se le foto non mostrano una moneta euro (o sono troppo rovinate), restituisci {"candidates":[]}.
Non inventare un anno che non vedi. Basati su dettagli realmente visibili: il lato comune aiuta a capire il taglio, il lato nazionale a capire paese, anno e tipo.`;

interface VisionChoice {
  message?: { content?: unknown };
}

function extractContent(payload: unknown): string {
  const choices = (payload as { choices?: VisionChoice[] } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : ""
      )
      .join("");
  }
  return "";
}

async function askVisionModel(
  front: string,
  back: string
): Promise<{ candidates: VisionCandidate[]; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  const base = (
    process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions")
    ? base
    : `${base}/chat/completions`;
  const model = process.env.OPENAI_VISION_MODEL?.trim() || DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 900,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Foto 1 — FRONTE (lato nazionale della moneta).",
              },
              { type: "image_url", image_url: { url: front, detail: "high" } },
              {
                type: "text",
                text: "Foto 2 — RETRO (lato comune della moneta).",
              },
              { type: "image_url", image_url: { url: back, detail: "high" } },
              {
                type: "text",
                text: "Identifica la moneta e rispondi con il JSON richiesto.",
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (e) {
    console.error("[recognize] errore rete provider:", e);
    throw new Error("AI_NETWORK");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      `[recognize] provider ${response.status}: ${detail.replace(/\s+/g, " ").slice(0, 300)}`
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error("AI_AUTH");
    }
    if (response.status === 429) throw new Error("AI_RATE");
    throw new Error("AI_FAILED");
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const content = extractContent(payload);
  return { candidates: parseVisionOutput(content), model };
}

export async function POST(
  request: Request
): Promise<NextResponse<RecognizeResponse>> {
  if (rateLimited(clientKey(request))) {
    return fail(
      429,
      "RATE_LIMITED",
      "Hai fatto troppe scansioni in poco tempo: attendi qualche minuto e riprova."
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 6_000_000) {
    return fail(
      413,
      "PAYLOAD_TOO_LARGE",
      "Foto troppo pesanti: scatta di nuovo fronte e retro (max 2,5 MB ciascuna)."
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "BAD_REQUEST", "Richiesta non valida: mancano le foto.");
  }

  const { front, back } = (body ?? {}) as { front?: unknown; back?: unknown };
  if (!isDataUrl(front) || !isDataUrl(back)) {
    return fail(
      400,
      "BAD_REQUEST",
      "Foto non valide: scatta di nuovo fronte e retro (JPEG/PNG, max 2,5 MB ciascuna)."
    );
  }

  const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
  if (!configured) {
    return fail(
      503,
      "AI_NOT_CONFIGURED",
      "Riconoscimento automatico non configurato. Aggiungi OPENAI_API_KEY alle variabili d'ambiente (vedi .env.example) e riavvia l'app. Nel frattempo puoi cercare la moneta a mano."
    );
  }

  try {
    const { candidates } = await askVisionModel(front, back);
    const matched = matchVisionCandidates(candidates, 3);
    return NextResponse.json({ ok: true, candidates: matched });
  } catch (e) {
    const code = e instanceof Error ? e.message : "AI_FAILED";
    if (code === "AI_NOT_CONFIGURED") {
      return fail(
        503,
        "AI_NOT_CONFIGURED",
        "Riconoscimento automatico non configurato: manca OPENAI_API_KEY. Puoi comunque cercare la moneta a mano."
      );
    }
    if (code === "AI_AUTH") {
      return fail(
        502,
        "AI_AUTH",
        "La chiave API del riconoscimento non è valida o è scaduta: controlla OPENAI_API_KEY su Vercel (o in .env.local)."
      );
    }
    if (code === "AI_RATE") {
      return fail(
        502,
        "AI_RATE",
        "Il servizio di riconoscimento ha troppe richieste in questo momento: riprova tra poco o cerca la moneta a mano."
      );
    }
    if (code === "AI_NETWORK") {
      return fail(
        502,
        "AI_NETWORK",
        "Impossibile raggiungere il servizio di riconoscimento: controlla la connessione e riprova, oppure cerca la moneta a mano."
      );
    }
    console.error("[recognize] errore riconoscimento:", e);
    return fail(
      502,
      "AI_FAILED",
      "Il riconoscimento non è riuscito. Rifai le foto con più luce e la moneta ferma, oppure cercala a mano."
    );
  }
}
