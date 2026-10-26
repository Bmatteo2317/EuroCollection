"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CountrySummary } from "@/lib/catalog";
import CountryFlag from "@/components/CountryFlag";

export default function CountryExplorer({
  countries,
}: {
  countries: CountrySummary[];
}) {
  const [q, setQ] = useState("");
  const [onlyComm, setOnlyComm] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return countries.filter((c) => {
      if (onlyComm && c.commemoratives === 0) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.code.toLowerCase().includes(needle)
      );
    });
  }, [countries, q, onlyComm]);

  return (
    <section>
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/70 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900/70">
        <label className="relative flex-1 sm:max-w-sm">
          <span className="sr-only">Cerca paese</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca paese o codice…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-400/10 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={onlyComm}
            onChange={(e) => setOnlyComm(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-emerald-600"
          />
          Solo paesi con commemorativi
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {filtered.map((c) => (
          <Link
            key={c.code}
            href={`/paese/${c.code}`}
            className="group rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition duration-200 hover:border-amber-300 hover:shadow-xl hover:shadow-amber-950/5 sm:p-5 sm:hover:-translate-y-1 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="h-8">
              <CountryFlag code={c.code} name={c.name} size={36} />
            </div>
            <div className="mt-2.5 text-sm font-bold leading-tight break-words text-slate-900 sm:mt-3 sm:text-base dark:text-slate-50">
              {c.name}
            </div>
            <div className="mt-1 text-[11px] text-zinc-500 sm:text-xs">
              {c.total} monete · {c.commemoratives} comm.
            </div>
            <div className="mt-2.5 text-[11px] font-bold text-amber-600 group-hover:underline sm:mt-3 sm:text-xs dark:text-amber-300">
              Apri catalogo →
            </div>
          </Link>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-zinc-500">
          Nessun paese trovato.
        </p>
      )}
    </section>
  );
}
