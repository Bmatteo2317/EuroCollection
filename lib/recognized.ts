import type { CatalogCoin } from "@/lib/catalog";

/**
 * Moneta proposta dal riconoscimento fotografico (o dalla ricerca manuale
 * di correzione). È un sottoinsieme serializzabile di `CatalogCoin`:
 * niente funzioni, solo i campi che servono alla UI per mostrare la
 * proposta e per aggiungerla alla collezione.
 */
export interface RecognizedCoin {
  /** ID stabile del catalogo (`coinId`), chiave di `user_collection`. */
  id: string;
  country: string;
  countryName: string;
  denomination: string;
  /** Etichetta leggibile: "2 €", "50 cent", ... */
  faceValue: string;
  /** Anno del disegno (prima emissione), es. 2002 per le divisionali. */
  designYear: number;
  isCommemorative: boolean;
  description: string;
  /** URL dell'immagine ufficiale BCE. */
  url: string;
  /** Tutti gli anni in cui il disegno è circolato. */
  years: number[];
  /**
   * Anno effettivamente letto sulle foto e valido per questo disegno.
   * `null` quando il modello non è riuscito a leggerlo (o per la ricerca
   * manuale): in quel caso la UI fa scegliere l'anno.
   */
  matchedYear: number | null;
  /** Confidenza del modello 0..1 (0 per la ricerca manuale). */
  confidence: number;
}

export type RecognizeResponse =
  | { ok: true; candidates: RecognizedCoin[] }
  | { ok: false; code: string; error: string };

/** Anno da mostrare all'utente: quello letto, altrimenti quello del disegno. */
export function coinDisplayYear(coin: RecognizedCoin): number {
  return coin.matchedYear ?? coin.designYear;
}

/** Etichetta compatta: "2 € · Italia · 2004". */
export function coinLabel(coin: RecognizedCoin): string {
  return `${coin.faceValue} · ${coin.countryName} · ${coinDisplayYear(coin)}`;
}

/** Converte una moneta del catalogo nel formato serializzabile alla UI. */
export function toRecognizedCoin(
  coin: CatalogCoin,
  confidence: number,
  matchedYear: number | null
): RecognizedCoin {
  return {
    id: coin.id,
    country: coin.country,
    countryName: coin.countryName,
    denomination: coin.denomination,
    faceValue: coin.faceValue,
    designYear: coin.year,
    isCommemorative: coin.isCommemorative,
    description: coin.description,
    url: coin.url,
    years: coin.years,
    matchedYear,
    confidence,
  };
}
