import {
  getCatalog,
  getCountriesWithCounts,
  getTotalCount,
} from "@/lib/catalog";
import { ensureDeviceUserId } from "@/lib/auth";
import { fetchOwnershipSafe, fetchYearsSafe } from "@/lib/collection";
import type {
  CoinYearsMap,
  CollectionMap,
  OwnershipMap,
} from "@/lib/types";
import ProgressCircle from "@/components/ProgressCircle";
import CompletionDonut from "@/components/CompletionDonut";
import CountryFlag from "@/components/CountryFlag";
import CoinGrid from "@/components/CoinGrid";
import PhotoCoinScanner from "@/components/PhotoCoinScanner";

// Pagina personale: mai prerenderizzata in build (usa cookies()).
export const dynamic = "force-dynamic";

export default async function CollezionePage() {
  // Niente login: la pagina crea da sola l'account del dispositivo.
  // Se il DB è giù, ensure lancia → pagina gestita dal boundary (error.tsx).
  const userId = await ensureDeviceUserId().catch(() => null);

  // Mai far crashare la pagina per un errore di lettura collezione:
  // un throw qui, durante la revalidazione scatenata da una Server Action
  // (es. + su una moneta), si propaga al client come
  // "Minified React error #441". Le versioni Safe non lanciano mai.
  let collection: CollectionMap = {};
  let details: OwnershipMap = {};
  let coinYears: CoinYearsMap = {};
  if (userId) {
    const fetched = await fetchOwnershipSafe(userId);
    collection = fetched.quantities;
    details = fetched.details;
    coinYears = await fetchYearsSafe(userId);
  }

  const catalog = getCatalog();
  const total = getTotalCount();
  const ownedIds = new Set(Object.keys(collection));
  const ownedCoins = catalog.filter((c) => ownedIds.has(c.id));
  const owned = ownedCoins.length;
  const pieces = ownedCoins.reduce((s, c) => s + (collection[c.id] ?? 0), 0);
  const duplicates = ownedCoins.filter((c) => (collection[c.id] ?? 0) > 1).length;

  // Ripartizione divisionali vs commemorativi (possedute e totali).
  const ownedRegular = ownedCoins.filter((c) => !c.isCommemorative).length;
  const ownedComm = owned - ownedRegular;
  const totalComm = catalog.filter((c) => c.isCommemorative).length;
  const totalRegular = total - totalComm;

  const byCountry = getCountriesWithCounts().map((c) => {
    const countryCoins = catalog.filter((coin) => coin.country === c.code);
    const ownedCountry = countryCoins.filter((coin) => ownedIds.has(coin.id));
    return {
      ...c,
      owned: ownedCountry.length,
      ownedComm: ownedCountry.filter((coin) => coin.isCommemorative).length,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold">La mia collezione</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {pieces} pezzi totali · {owned} tipi distinti · {duplicates} doppioni
          </p>
        </div>
        <PhotoCoinScanner />
      </header>

      <section className="grid gap-4 rounded-3xl border border-zinc-200 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
        <ProgressCircle owned={owned} total={total} />
        <CompletionDonut
          ownedRegular={ownedRegular}
          ownedComm={ownedComm}
          totalRegular={totalRegular}
          totalComm={totalComm}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Avanzamento per paese</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {byCountry.map((c) => {
            const pct = c.total ? (c.owned / c.total) * 100 : 0;
            return (
              <a
                key={c.code}
                href={`/paese/${c.code}`}
                className="rounded-2xl border border-zinc-200 bg-white p-3 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <CountryFlag code={c.code} name={c.name} size={22} />
                    <strong>{c.name}</strong>
                  </span>
                  <span className="tabular-nums text-zinc-500">
                    {c.owned}/{c.total}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {c.ownedComm}/{c.commemoratives} commemorativi ·{" "}
                  {pct.toFixed(1)}% completato
                </p>
              </a>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Monete possedute ({owned})</h2>
        {owned === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Ancora nessuna moneta. Vai nel{" "}
            <a
              href="/"
              className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
            >
              catalogo
            </a>{" "}
            e premi + sulle monete che hai. Puoi anche usare “Aggiungi con
            foto” qui sopra per riconoscerne una dal fronte e dal retro.
          </p>
        ) : (
          <CoinGrid
            coins={ownedCoins.sort((a, b) => b.year - a.year)}
            initialCollection={collection}
            initialDetails={details}
            initialYears={coinYears}
            isGuest={false}
          />
        )}
      </section>
    </div>
  );
}
