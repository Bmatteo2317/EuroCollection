import {
  COUNTRIES,
  DENOMINATIONS,
  getAllCoins,
  type CoinSource,
  type CoinType,
  type CountryCode,
  type Denomination,
} from "@euro-coins/source";
import extraCoins from "@/data/coins-extra.json";

export type { CoinSource, CountryCode, Denomination };
export { COUNTRIES, DENOMINATIONS };

// ---------------------------------------------------------------------------
// ID stabile per ogni moneta: chiave logica di `user_collection.coin_id`.
// Formato: "<country>-<year>-<denomination>-<type>-<index>"
// Es: "it-2004-2euro-commemorative-0"
// ---------------------------------------------------------------------------
export function coinId(coin: CoinSource): string {
  return `${coin.country}-${coin.year}-${coin.denomination}-${coin.type}-${coin.index}`;
}

export interface CatalogCoin extends CoinSource {
  /** ID stabile (`coinId`), chiave di `CollectionMap` e di `user_collection`. */
  id: string;
  /** Etichetta leggibile: "2 €" / "1 €" / "50 cent" / ... */
  faceValue: string;
  /** Nome del paese in italiano. */
  countryName: string;
  /** Descrizione curata dove verificata, altrimenti fallback neutro. */
  description: string;
  isCommemorative: boolean;
  /** true se la descrizione è curata a mano, false se generata. */
  isEnriched: boolean;
  /** Metallo/colore reale del taglio (come le monete vere). */
  metal: MetalInfo;
  /**
   * Anni coperti da questo disegno, per la collezione "tutti gli anni".
   * - Divisionali: tutti gli anni in cui il disegno è circolato
   *   (dal primo conio del paese — o dalla data del disegno se successiva —
   *   fino all'anno corrente, esclusi gli anni dei disegni successivi).
   * - Commemorativi: [anno di emissione] (pezzo unico annuale).
   */
  years: number[];
}

/** Metalli degli euro: rame (1-2-5 cent), oro nordico (10-20-50 cent), bimetalliche (1-2 €). */
export type MetalKey = "copper" | "gold" | "bimetal";

export interface MetalInfo {
  key: MetalKey;
  /** Etichetta numismatica: "Rame" / "Oro nordico" / "Bimetallica". */
  label: string;
  /** Valore CSS per il pallino colore (tinta unita o gradiente bimetallico). */
  swatch: string;
}

export function denominationMetal(d: Denomination): MetalInfo {
  switch (d) {
    case "1cent":
    case "2cent":
    case "5cent":
      return { key: "copper", label: "Rame", swatch: "#b87333" };
    case "10cent":
    case "20cent":
    case "50cent":
      return { key: "gold", label: "Oro nordico", swatch: "#c9a227" };
    default:
      return {
        key: "bimetal",
        label: "Bimetallica",
        swatch: "linear-gradient(135deg, #c9a227 50%, #c0c4cc 50%)",
      };
  }
}

// NOTA SUL PACKAGE: `@euro-coins/source` fornisce SOLO
// { country, year, denomination, type, index, url }.
// Descrizioni NON esistono nel package: le regole qui sotto
// associano una scheda curata tramite frammenti degli URL BCE (stabili e
// verificati), con fallback neutro generato. Per estendere: aggiungi una
// regola { country, urlIncludes, description }.
interface EnrichmentRule {
  /** Codice paese, oppure "*" per le emissioni comuni a tutta l'Eurozona. */
  country: CountryCode | "*";
  /** Frammento da cercare nell'URL BCE della moneta (case-insensitive). */
  urlIncludes: string;
  description: string;
}

const ENRICHMENT: readonly EnrichmentRule[] = [
  // ---- Emissioni comuni (stesso tema in tutta l'Eurozona) ----
  {
    country: "*",
    urlIncludes: "joint_comm_2007",
    description:
      "Emissione comune — 50° anniversario dei Trattati di Roma.",
  },
  {
    country: "*",
    urlIncludes: "joint_comm_2009",
    description:
      "Emissione comune — 10° anniversario dell'Unione economica e monetaria.",
  },
  {
    country: "*",
    urlIncludes: "joint_comm_2012",
    description:
      "Emissione comune — 10 anni delle monete e banconote in euro.",
  },
  {
    country: "*",
    urlIncludes: "joint_comm_2015",
    description:
      "Emissione comune — 30° anniversario della bandiera europea.",
  },
  {
    country: "*",
    urlIncludes: "erasmus",
    description:
      "Emissione comune — 35° anniversario del programma Erasmus.",
  },

  // ---- Italia ----
  {
    country: "it",
    urlIncludes: "comm_2004_it",
    description:
      "50° anniversario del Programma Alimentare Mondiale (WFP).",
  },
  {
    country: "it",
    urlIncludes: "comm_2005_it",
    description:
      "1° anniversario della firma della Costituzione europea.",
  },
  {
    country: "it",
    urlIncludes: "comm_2006_it",
    description: "XX Giochi olimpici invernali di Torino 2006.",
  },
  {
    country: "it",
    urlIncludes: "comm_2008_Italy",
    description:
      "60° anniversario della Dichiarazione universale dei diritti umani.",
  },
  {
    country: "it",
    urlIncludes: "comm_2009_it",
    description: "200° anniversario della nascita di Louis Braille.",
  },
  {
    country: "it",
    urlIncludes: "comm_2010_it",
    description:
      "200° anniversario della nascita di Camillo Benso, conte di Cavour.",
  },
  {
    country: "it",
    urlIncludes: "comm_2011_it",
    description: "150° anniversario dell'Unità d'Italia.",
  },
  {
    country: "it",
    urlIncludes: "Italy_Verdi",
    description: "200° anniversario della nascita di Giuseppe Verdi.",
  },
  {
    country: "it",
    urlIncludes: "Italy_Boccaccio",
    description: "700° anniversario della nascita di Giovanni Boccaccio.",
  },
  {
    country: "it",
    urlIncludes: "Italy_expo",
    description: "Expo Milano 2015 — Nutrire il pianeta.",
  },
  {
    country: "it",
    urlIncludes: "500anniv_Leodavinci",
    description: "500° anniversario della morte di Leonardo da Vinci.",
  },

  // ---- Finlandia ----
  {
    country: "fi",
    urlIncludes: "comm_2004_fi",
    description:
      "Allargamento dell'Unione europea ai dieci nuovi Stati membri.",
  },
  {
    country: "fi",
    urlIncludes: "comm_2005_fi",
    description: "60° anniversario delle Nazioni Unite.",
  },
  {
    country: "fi",
    urlIncludes: "comm_2006_fi",
    description:
      "100° anniversario del suffragio universale in Finlandia.",
  },
  {
    country: "fi",
    urlIncludes: "finland_independence",
    description: "100° anniversario dell'indipendenza della Finlandia.",
  },

  // ---- Germania (serie dei Länder) ----
  {
    country: "de",
    urlIncludes: "comm_2006_de",
    description:
      "Schleswig-Holstein — Holstentor di Lubecca (serie dei Länder).",
  },
  {
    country: "de",
    urlIncludes: "comm_2007_Germany",
    description:
      "Meclemburgo-Pomerania Anteriore — Castello di Schwerin (serie dei Länder).",
  },
  {
    country: "de",
    urlIncludes: "comm_2008_de",
    description: "Amburgo — Chiesa di San Michele (serie dei Länder).",
  },
  {
    country: "de",
    urlIncludes: "comm_2009_de",
    description: "Saarland — Ludwigskirche di Saarbrücken (serie dei Länder).",
  },
  {
    country: "de",
    urlIncludes: "comm_2010_de",
    description:
      "Brema — Municipio e statua di Rolando (serie dei Länder).",
  },
  {
    country: "de",
    urlIncludes: "comm_2015_de_Hessen",
    description: "Assia — Paulskirche di Francoforte (serie dei Länder).",
  },
  {
    country: "de",
    urlIncludes: "30anniv_fallBerlinwall",
    description: "30° anniversario della caduta del Muro di Berlino.",
  },

  // ---- San Marino ----
  {
    country: "sm",
    urlIncludes: "comm_2004_sm",
    description: "Bartolomeo Borghesi — storico e numismatico sammarinese.",
  },
  {
    country: "sm",
    urlIncludes: "comm_2005_sm",
    description: "Anno internazionale della fisica.",
  },
  {
    country: "sm",
    urlIncludes: "comm_2006_sm",
    description: "500° anniversario della morte di Cristoforo Colombo.",
  },
  {
    country: "sm",
    urlIncludes: "comm_2007_San_marino",
    description: "200° anniversario della nascita di Giuseppe Garibaldi.",
  },
  {
    country: "sm",
    urlIncludes: "comm_2008_San_Marino",
    description: "Anno europeo del dialogo interculturale.",
  },
  {
    country: "sm",
    urlIncludes: "comm_2011_sm",
    description: "500° anniversario della nascita di Giorgio Vasari.",
  },

  // ---- Vaticano ----
  {
    country: "va",
    urlIncludes: "comm_2004_va",
    description:
      "75° anniversario della fondazione dello Stato della Città del Vaticano.",
  },
  {
    country: "va",
    urlIncludes: "comm_2005_va",
    description: "XX Giornata mondiale della gioventù di Colonia.",
  },
  {
    country: "va",
    urlIncludes: "comm_2006_va",
    description: "500° anniversario della Guardia Svizzera Pontificia.",
  },
  {
    country: "va",
    urlIncludes: "comm_2007_va",
    description: "80° anniversario della nascita di Benedetto XVI.",
  },
  {
    country: "va",
    urlIncludes: "comm_2008_Vatican",
    description: "Anno Paolino — 2000° anniversario della nascita di San Paolo.",
  },
  {
    country: "va",
    urlIncludes: "vatican_mercy",
    description: "Giubileo straordinario della Misericordia.",
  },
  {
    country: "va",
    urlIncludes: "vt_sistine",
    description: "Cappella Sistina — 25° anniversario del restauro.",
  },

  // ---- Francia / Spagna ----
  {
    country: "fr",
    urlIncludes: "comm_2008_France1",
    description:
      "Presidenza francese del Consiglio dell'Unione europea.",
  },
  {
    country: "es",
    urlIncludes: "comm_2005_sp",
    description:
      "400° anniversario della prima edizione del Don Chisciotte.",
  },
];

export const COUNTRY_NAMES: Record<CountryCode, string> = {
  at: "Austria",
  be: "Belgio",
  bg: "Bulgaria",
  cy: "Cipro",
  de: "Germania",
  ee: "Estonia",
  es: "Spagna",
  fi: "Finlandia",
  fr: "Francia",
  gr: "Grecia",
  hr: "Croazia",
  ie: "Irlanda",
  it: "Italia",
  lt: "Lituania",
  lu: "Lussemburgo",
  lv: "Lettonia",
  mt: "Malta",
  nl: "Paesi Bassi",
  pt: "Portogallo",
  si: "Slovenia",
  sk: "Slovacchia",
  va: "Città del Vaticano",
  sm: "San Marino",
  mc: "Monaco",
  ad: "Andorra",
};

export const COUNTRY_FLAGS: Record<CountryCode, string> = {
  at: "🇦🇹",
  be: "🇧🇪",
  bg: "🇧🇬",
  cy: "🇨🇾",
  de: "🇩🇪",
  ee: "🇪🇪",
  es: "🇪🇸",
  fi: "🇫🇮",
  fr: "🇫🇷",
  gr: "🇬🇷",
  hr: "🇭🇷",
  ie: "🇮🇪",
  it: "🇮🇹",
  lt: "🇱🇹",
  lu: "🇱🇺",
  lv: "🇱🇻",
  mt: "🇲🇹",
  nl: "🇳🇱",
  pt: "🇵🇹",
  si: "🇸🇮",
  sk: "🇸🇰",
  va: "🇻🇦",
  sm: "🇸🇲",
  mc: "🇲🇨",
  ad: "🇦🇩",
};

/**
 * URL dell'immagine della bandiera (flagcdn.com, codici ISO alpha-2
 * minuscoli: coincidono con i nostri CountryCode, inclusi va/sm/mc/ad).
 * Le emoji bandiera non esistono su Windows (mostra "IT", "DE", ...),
 * quindi la UI usa queste immagini con fallback all'emoji.
 */
export function countryFlagUrl(code: CountryCode): string {
  return `https://flagcdn.com/w160/${code}.png`;
}

export function formatDenomination(d: Denomination): string {
  if (d === "2euro") return "2 €";
  if (d === "1euro") return "1 €";
  return `${d.replace("cent", "")} cent`;
}

function fallbackDescription(coin: CoinSource): string {
  const base = `${formatDenomination(coin.denomination)} · ${COUNTRY_NAMES[coin.country] ?? coin.country} · ${coin.year}`;
  return coin.type === "commemorative"
    ? `2 € commemorativo — ${base}.`
    : `Moneta divisionale — ${base}.`;
}

function findEnrichmentRule(coin: CoinSource): EnrichmentRule | undefined {
  const url = coin.url.toLowerCase();
  return ENRICHMENT.find(
    (rule) =>
      (rule.country === "*" || rule.country === coin.country) &&
      url.includes(rule.urlIncludes.toLowerCase())
  );
}

function toCatalogCoin(coin: CoinSource, curated?: string): CatalogCoin {
  // Una scheda scritta a mano (overlay) vince sulle regole sugli URL BCE.
  const rule = curated ? undefined : findEnrichmentRule(coin);
  return {
    ...coin,
    id: coinId(coin),
    faceValue: formatDenomination(coin.denomination),
    countryName: COUNTRY_NAMES[coin.country] ?? coin.country.toUpperCase(),
    description: curated ?? rule?.description ?? fallbackDescription(coin),
    isCommemorative: coin.type === "commemorative",
    isEnriched: Boolean(curated ?? rule),
    metal: denominationMetal(coin.denomination),
    years: [coin.year],
  };
}

/**
 * Primo anno di circolazione dell'euro per paese (i disegni datati prima,
 * es. 1999, coprono comunque da qui). L'anno corrente è il limite superiore.
 */
export const CIRCULATION_START: Record<CountryCode, number> = {
  at: 2002, be: 2002, de: 2002, es: 2002, fi: 2002, fr: 2002, gr: 2002,
  ie: 2002, it: 2002, lu: 2002, mc: 2002, nl: 2002, pt: 2002, sm: 2002,
  va: 2002, si: 2007, cy: 2008, mt: 2008, sk: 2009, ee: 2011, lv: 2014,
  ad: 2014, lt: 2015, hr: 2023, bg: 2026,
};

/**
 * Assegna a ogni divisionale gli anni del suo disegno: raggruppa per
 * (paese, taglio), ordina i disegni per anno e ritaglia ogni intervallo
 * [max(disegno, primoConio) .. min(disegnoSuccessivo - 1, annoCorrente)].
 * Mutazione intenzionale su array appena creato da getCatalog() (puro).
 */
function assignDesignYears(coins: CatalogCoin[]): void {
  const now = new Date().getFullYear();
  const groups = new Map<string, CatalogCoin[]>();
  for (const coin of coins) {
    if (coin.isCommemorative) continue; // years già = [anno]
    const key = `${coin.country}|${coin.denomination}`;
    const list = groups.get(key);
    if (list) list.push(coin);
    else groups.set(key, [coin]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.year - b.year);
    list.forEach((design, i) => {
      const start = Math.max(
        design.year,
        CIRCULATION_START[design.country] ?? design.year
      );
      const end = Math.min((list[i + 1]?.year ?? now + 1) - 1, now);
      const years: number[] = [];
      for (let y = start; y <= end; y++) years.push(y);
      design.years = years;
    });
  }
}

/**
 * Catalogo completo arricchito.
 *
 * Serverless-safe: funzione PURA, senza cache globale mutabile.
 * Ogni invocazione ricalcola da `getAllCoins()` (dati statici del package),
 * quindi è sicura su Vercel Edge/Serverless dove le istanze sono effimere.
 * Next.js memorizza comunque il risultato nelle pagine statiche
 * (`generateStaticParams` + `revalidate`), senza bisogno di singleton.
 */
// ---------------------------------------------------------------------------
// OVERLAY: monete non ancora nel pacchetto.
//
// `@euro-coins/source` è un pacchetto npm: una moneta emessa oggi compare solo
// alla release successiva. `data/coins-extra.json` copre quel buco senza
// aspettare: le voci scritte lì si aggiungono al catalogo con lo STESSO id
// (`coinId`) che avrà la voce ufficiale, così quando il pacchetto la include
// i segni nella collezione non si perdono (la voce doppia viene scartata).
//
// Il file lo aggiorna `npm run coins:sync` leggendo le pagine BCE per anno;
// si può anche scrivere a mano. Gli id restano stabili: mai rinumerare
// `index` di una voce già presente.
// ---------------------------------------------------------------------------

interface ExtraCoin {
  country: CountryCode;
  year: number;
  denomination: Denomination;
  type: CoinType;
  /** Progressivo per (paese, anno, taglio, tipo): 0, 1, 2... */
  index?: number;
  /** URL BCE dell'immagine; se assente si usa il segnaposto locale. */
  url?: string;
  /** Scheda curata in italiano. */
  description?: string;
}

/** La BCE non ha ancora pubblicato la foto: meglio un segnaposto che un'immagine rotta. */
const PLACEHOLDER_COIN_IMAGE = "/coins/placeholder.svg";

const EXTRA_COINS: readonly ExtraCoin[] = (
  extraCoins as unknown as { coins?: ExtraCoin[] }
).coins ?? [];

export function getCatalog(): CatalogCoin[] {
  const catalog = getAllCoins().map((coin) => toCatalogCoin(coin));
  const known = new Set(catalog.map((coin) => coin.id));

  for (const extra of EXTRA_COINS) {
    const coin: CoinSource = {
      country: extra.country,
      year: extra.year,
      denomination: extra.denomination,
      type: extra.type,
      index: extra.index ?? 0,
      url: extra.url?.trim() || PLACEHOLDER_COIN_IMAGE,
    };
    const id = coinId(coin);
    // Già arrivata nel pacchetto: vince la voce ufficiale, niente doppioni.
    if (known.has(id)) continue;
    known.add(id);
    catalog.push(toCatalogCoin(coin, extra.description));
  }

  assignDesignYears(catalog);
  return catalog;
}

export interface CountrySummary {
  code: CountryCode;
  name: string;
  flag: string;
  total: number;
  commemoratives: number;
}

export function getCountriesWithCounts(): CountrySummary[] {
  const catalog = getCatalog();
  return COUNTRIES.map((code) => {
    const coins = catalog.filter((c) => c.country === code);
    return {
      code,
      name: COUNTRY_NAMES[code] ?? code.toUpperCase(),
      flag: COUNTRY_FLAGS[code] ?? "🇪🇺",
      total: coins.length,
      commemoratives: coins.filter((c) => c.isCommemorative).length,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "it"));
}

export function getCoinsByCountry(country: string): CatalogCoin[] {
  return getCatalog()
    .filter((c) => c.country === country)
    .sort((a, b) => {
      if (a.isCommemorative !== b.isCommemorative)
        return a.isCommemorative ? -1 : 1;
      if (a.year !== b.year) return b.year - a.year;
      return (
        DENOMINATIONS.indexOf(a.denomination) -
        DENOMINATIONS.indexOf(b.denomination)
      );
    });
}

export function getTotalCount(): number {
  return getCatalog().length;
}

export function isValidCountry(code: string): code is CountryCode {
  return (COUNTRIES as readonly string[]).includes(code);
}
