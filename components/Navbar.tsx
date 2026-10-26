import Link from "next/link";
import { getProfile } from "@/app/actions/profile";
import ThemeToggle from "@/components/ThemeToggle";

export default async function Navbar() {
  // Mai far crashare il layout: senza profilo si mostra "Profilo".
  const profile = await getProfile().catch(() => null);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[var(--ec-canvas)]/85 backdrop-blur-xl dark:border-slate-800/80">
      {/* Su telefono resta una sola riga: monogramma EC (il nome esteso
          riappare da 520px, dove c'è spazio) + link + azioni. I link stanno
          in una striscia che scorre in orizzontale invece di sovrapporsi al
          logo quando lo schermo è molto stretto (320px). */}
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2 text-base font-black tracking-tight sm:text-lg">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-600 text-sm text-slate-950 shadow-lg shadow-amber-900/15 transition-transform group-hover:rotate-6">EC</span>
          <span className="hidden min-[520px]:inline">Euro<span className="text-amber-500">Collection</span></span>
        </Link>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 text-xs sm:gap-2 sm:text-sm">
          <div className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto [scrollbar-width:none] sm:flex-none sm:gap-2 [&::-webkit-scrollbar]:hidden">
            <Link
              href="/"
              className="flex min-h-10 shrink-0 items-center rounded-xl px-1.5 text-slate-600 transition-colors hover:bg-white hover:text-slate-950 sm:min-h-0 sm:px-3 sm:py-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Catalogo
            </Link>
            <Link
              href="/collezione"
              className="flex min-h-10 shrink-0 items-center rounded-xl px-1.5 text-slate-600 transition-colors hover:bg-white hover:text-slate-950 sm:min-h-0 sm:px-3 sm:py-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <span className="hidden min-[420px]:inline">La mia collezione</span>
              <span className="min-[420px]:hidden">Collezione</span>
            </Link>
            <Link
              href="/scambi"
              className="flex min-h-10 shrink-0 items-center rounded-xl px-1.5 text-slate-600 transition-colors hover:bg-white hover:text-slate-950 sm:min-h-0 sm:px-3 sm:py-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Scambi
            </Link>
          </div>
          <span className="shrink-0">
            <ThemeToggle />
          </span>
          <Link
            href="/profilo"
            aria-label={profile ? `Profilo di ${profile.displayName}` : "Profilo"}
            className="flex size-9 shrink-0 items-center justify-center gap-1 rounded-full bg-zinc-900 px-0 text-sm font-medium text-white sm:h-auto sm:w-auto sm:max-w-40 sm:px-3 sm:py-1.5 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <span aria-hidden="true">{profile ? profile.avatar : "👤"}</span>
            <span className="hidden truncate sm:inline">
              {profile ? profile.displayName : "Profilo"}
            </span>
          </Link>
        </div>
      </nav>
    </header>
  );
}
