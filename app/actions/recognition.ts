"use server";

import { getCatalog, type CatalogCoin } from "@/lib/catalog";
import { toRecognizedCoin, type RecognizedCoin } from "@/lib/recognized";

/**
 * Ricerca manuale di soccorso: quando il riconoscimento automatico sbaglia
 * moneta (o non è configurato), l'utente può cercarla nel catalogo reale.
 * Restituisce al massimo 30 risultati compatti, mai un throw: la UI deve
 * restare usabile anche se qualcosa va storto.
 */
export async function searchCoins(query: string): Promise<RecognizedCoin[]> {
  try {
    const needle = fold(typeof query === "string" ? query : "")
      .trim()
      .slice(0, 80);
    if (needle.length < 2) return [];
    const terms = needle.split(/\s+/).filter(Boolean);

    const ranked: { coin: CatalogCoin; score: number }[] = [];
    for (const coin of getCatalog()) {
      const country = fold(coin.countryName);
      const face = fold(coin.faceValue);
      const description = fold(coin.description);
      const haystack = `${country} ${coin.country} ${face} ${coin.denomination} ${coin.year} ${coin.years.join(" ")} ${description}`;

      let score = 0;
      let matchesAll = true;
      for (const term of terms) {
        if (!haystack.includes(term)) {
          matchesAll = false;
          break;
        }
        if (country.includes(term)) score += 5;
        if (String(coin.year) === term) score += 9;
        else if (coin.years.includes(Number(term))) score += 5;
        if (term.length >= 2 && face.includes(term)) score += 4;
        if (description.includes(term)) score += 2;
      }
      if (matchesAll) ranked.push({ coin, score });
    }

    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.coin.isCommemorative) - Number(a.coin.isCommemorative) ||
        b.coin.year - a.coin.year
    );

    return ranked
      .slice(0, 30)
      .map(({ coin }) => toRecognizedCoin(coin, 0, null));
  } catch (e) {
    console.error("[recognition] ricerca manuale fallita:", e);
    return [];
  }
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
