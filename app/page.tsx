import Link from "next/link";
import {
  getCatalog,
  getCountriesWithCounts,
  getTotalCount,
} from "@/lib/catalog";
import { getDeviceUserId } from "@/lib/auth";
import { fetchOwnershipSafe, fetchYearsSafe } from "@/lib/collection";
import ProgressCircle from "@/components/ProgressCircle";
import CountryExplorer from "@/components/CountryExplorer";
import CoinGrid from "@/components/CoinGrid";
import type { CollectionMap, CoinYearsMap, OwnershipMap } from "@/lib/types";

// Pagina personalizzata (mostra il progresso dell'utente loggato):
// deve essere renderizzata dinamicamente, non prerenderizzata in build
// (usa cookies() via sessione). Il catalogo resta economico da calcolare
// per-request (~879 monete da dati statici del package).
export const dynamic = "force-dynamic";

export default async function Home() {
  const countries = getCountriesWithCounts();
  const total = getTotalCount();
  const catalog = getCatalog();
  const commemoratives = catalog.filter((c) => c.isCommemorative).slice(0, 10);

  // Collezione del dispositivo per statistiche + UI in home.
  // Niente login: il primo + crea da solo l'account (provision lazy).
  let collection: CollectionMap = {};
  let details: OwnershipMap = {};
  let coinYears: CoinYearsMap = {};
  let owned = 0;
  const deviceId = await getDeviceUserId();
  if (deviceId) {
    // Versioni Safe: MAI throw (un throw qui = pagina #441 in produzione).
    const fetched = await fetchOwnershipSafe(deviceId);
    collection = fetched.quantities;
    details = fetched.details;
    coinYears = await fetchYearsSafe(deviceId);
    owned = Object.keys(collection).length;
  }

  return (
    <div className="flex flex-col gap-14 pb-10">
      <section className="relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-slate-950 px-6 py-8 text-white shadow-2xl shadow-slate-900/10 sm:px-10 sm:py-12 lg:px-14">
        <div className="pointer-events-none absolute -right-24 -top-32 size-96 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 size-80 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-amber-300">Il tuo archivio numismatico</p>
            <h1 className="max-w-2xl text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
              Colleziona con metodo. <span className="text-amber-300">Scopri di più.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
              Un catalogo curato per tenere sotto controllo ogni moneta Euro, dagli esemplari quotidiani ai 2 € commemorativi più ricercati.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/collezione" className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-amber-950/20 transition hover:-translate-y-0.5 hover:bg-amber-300">
                Apri la mia collezione
              </Link>
              <Link href="/profilo" className="rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Personalizza profilo
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-6 text-sm text-slate-300">
              <span><strong className="text-white">{total}</strong> monete catalogate</span>
              <span><strong className="text-white">{countries.length}</strong> paesi europei</span>
              <span><strong className="text-white">{owned}</strong> nella tua raccolta</span>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end"><ProgressCircle owned={owned} total={total} /></div>
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">Esplora il catalogo</p><h2 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Scegli un paese</h2></div>
          <span className="text-sm text-slate-500">{countries.length} collezioni nazionali</span>
        </div>
        <CountryExplorer countries={countries} />
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">Da non perdere</p><h2 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">2 € commemorativi</h2></div>
          <Link href="/paese/it" className="rounded-lg px-3 py-2 text-sm font-bold text-amber-600 transition hover:bg-amber-50 dark:hover:bg-amber-950/30">Vedi l&apos;Italia <span aria-hidden="true">→</span></Link>
        </div>
        <CoinGrid coins={commemoratives} initialCollection={collection} initialDetails={details} initialYears={coinYears} isGuest={false} />
      </section>
    </div>
  );
}
