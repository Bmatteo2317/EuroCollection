import { COUNTRY_NAMES, getCatalog, type CatalogCoin } from "@/lib/catalog";
import { toRecognizedCoin, type RecognizedCoin } from "@/lib/recognized";

/**
 * Riconoscimento fotografico: il modello vision restituisce una lista di
 * candidati descritti a parole (paese, taglio, anno, tipo). Qui i candidati
 * vengono normalizzati e confrontati con il catalogo reale, così la UI
 * propone sempre una moneta esistente (con il suo ID stabile) e mai un
 * oggetto inventato dal modello.
 */

export interface VisionCandidate {
  country?: unknown;
  denomination?: unknown;
  year?: unknown;
  type?: unknown;
  description?: unknown;
  confidence?: unknown;
}

const COUNTRY_ALIASES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [code, name] of Object.entries(COUNTRY_NAMES)) {
    map[code] = code;
    map[fold(name)] = code;
  }
  Object.assign(map, {
    // Nomi inglesi / locali più frequenti nei ragionamenti dei modelli.
    austria: "at",
    osterreich: "at",
    belgium: "be",
    belgique: "be",
    belgien: "be",
    bulgaria: "bg",
    cyprus: "cy",
    germany: "de",
    deutschland: "de",
    estonia: "ee",
    spain: "es",
    espana: "es",
    finland: "fi",
    suomi: "fi",
    france: "fr",
    greece: "gr",
    hellas: "gr",
    croatia: "hr",
    hrvatska: "hr",
    ireland: "ie",
    eire: "ie",
    italy: "it",
    lithuania: "lt",
    luxembourg: "lu",
    latvia: "lv",
    malta: "mt",
    netherlands: "nl",
    holland: "nl",
    olanda: "nl",
    hollandia: "nl",
    portugal: "pt",
    slovenia: "si",
    slovenija: "si",
    slovakia: "sk",
    slovensko: "sk",
    vatican: "va",
    "vatican city": "va",
    "citta del vaticano": "va",
    "san marino": "sm",
    monaco: "mc",
    andorra: "ad",
  });
  return map;
})();

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = fold(value).replace(/[.]/g, "");
  return COUNTRY_ALIASES[key] ?? null;
}

/** "2 euro" / "2€" / "2eur" / "50 cent" / "0,50" -> "2euro" / "50cent". */
function normDenomination(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = fold(value).replace(/€/g, " euro ");
  const compact = s.replace(/[\s.]/g, "");
  const direct = [
    "2euro",
    "1euro",
    "50cent",
    "20cent",
    "10cent",
    "5cent",
    "2cent",
    "1cent",
    "2euros",
    "1euros",
  ].find((d) => compact.startsWith(d));
  if (direct) return direct.replace(/s$/, "");

  const match = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const number = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(number)) return null;

  const isCent = /cent|centesim/.test(s) || number < 1;
  if (isCent) {
    const cents = number < 1 ? Math.round(number * 100) : Math.round(number);
    return [1, 2, 5, 10, 20, 50].includes(cents) ? `${cents}cent` : null;
  }
  if (number === 1 || number === 2) return `${number}euro`;
  return [5, 10, 20, 50].includes(number) ? `${number}cent` : null;
}

function normYear(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  const year = Math.floor(n);
  if (!Number.isFinite(year) || year < 1999 || year > 2100) return null;
  return year;
}

function normType(value: unknown): "regular" | "commemorative" | null {
  if (typeof value !== "string") return null;
  const s = fold(value);
  if (/commemor|comm\.|speciale|special/.test(s)) return "commemorative";
  if (/regular|ordinari|division|circolaz|standard/.test(s)) return "regular";
  return null;
}

function normConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const v = value > 1 && value <= 100 ? value / 100 : value;
  return Math.max(0, Math.min(1, v));
}

const DESCRIPTION_STOPWORDS = new Set([
  "anno",
  "anni",
  "anniversario",
  "della",
  "delle",
  "degli",
  "dello",
  "giornata",
  "mondiale",
  "moneta",
  "monete",
  "euro",
  "cent",
  "commemorativo",
  "commemorativa",
  "divisionale",
  "nazionale",
  "comune",
  "disegno",
  "edizione",
  "programma",
  "europea",
  "europeo",
]);

function descriptionOverlap(description: string, coin: CatalogCoin): number {
  if (!description.trim()) return 0;
  const haystack = fold(
    `${coin.description} ${coin.countryName} ${coin.faceValue}`
  );
  const terms = fold(description)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !DESCRIPTION_STOPWORDS.has(t));
  return Math.min(4, new Set(terms.filter((t) => haystack.includes(t))).size);
}

/**
 * Confronta i candidati del modello con il catalogo BCE.
 * Più segnali concordano (paese + taglio + anno + tipo + descrizione),
 * più alta è la posizione. Ritorna al massimo `limit` monete distinte.
 */
export function matchVisionCandidates(
  raw: VisionCandidate[],
  limit = 3
): RecognizedCoin[] {
  const catalog = getCatalog();
  const scored = new Map<
    string,
    { coin: CatalogCoin; score: number; matchedYear: number | null; confidence: number }
  >();

  raw.slice(0, 5).forEach((candidate, index) => {
    const country = normCountry(candidate.country);
    const denomination = normDenomination(candidate.denomination);
    const year = normYear(candidate.year);
    const type = normType(candidate.type);
    const description =
      typeof candidate.description === "string"
        ? candidate.description.slice(0, 300)
        : "";
    const confidence = normConfidence(candidate.confidence) ?? 0.5;

    if (!country && !denomination) return;

    let pool = catalog;
    if (country && denomination) {
      pool = catalog.filter(
        (c) => c.country === country && c.denomination === denomination
      );
    } else if (country) {
      pool = catalog.filter((c) => c.country === country);
    } else if (denomination) {
      pool = catalog.filter((c) => c.denomination === denomination);
    }
    if (pool.length === 0) return;

    if (type) {
      const typed = pool.filter(
        (c) => c.isCommemorative === (type === "commemorative")
      );
      if (typed.length > 0) pool = typed;
    }

    if (year != null) {
      const exact = pool.filter((c) =>
        c.isCommemorative ? c.year === year : c.years.includes(year)
      );
      if (exact.length > 0) pool = exact;
    }

    const ranked = pool
      .map((coin) => {
        let score = confidence * 40 - index * 3;
        if (country) score += 6;
        if (denomination) score += 6;

        if (year != null) {
          if (
            coin.isCommemorative
              ? coin.year === year
              : coin.years.includes(year)
          ) {
            score += 30;
          } else if (!coin.isCommemorative) {
            score -= Math.min(20, Math.abs(coin.year - year) * 2);
          }
        }

        if (type) {
          score +=
            coin.isCommemorative === (type === "commemorative") ? 8 : -6;
        }

        score += descriptionOverlap(description, coin) * 3;

        const matchedYear =
          year != null &&
          (coin.isCommemorative
            ? coin.year === year
            : coin.years.includes(year))
            ? year
            : null;
        return { coin, score, matchedYear, confidence };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    for (const entry of ranked) {
      const previous = scored.get(entry.coin.id);
      if (!previous || previous.score < entry.score) {
        scored.set(entry.coin.id, entry);
      }
    }
  });

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) =>
      toRecognizedCoin(entry.coin, entry.confidence, entry.matchedYear)
    );
}

/** Estrae l'array `candidates` dal JSON restituito dal modello. */
export function parseVisionOutput(content: string): VisionCandidate[] {
  const cleaned = content
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      candidates?: unknown;
    };
    return Array.isArray(parsed.candidates)
      ? (parsed.candidates as VisionCandidate[]).filter(
          (c): c is VisionCandidate => !!c && typeof c === "object"
        )
      : [];
  } catch {
    return [];
  }
}
