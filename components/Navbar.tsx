import Link from "next/link";
import { getProfile } from "@/app/actions/profile";
import ThemeToggle from "@/components/ThemeToggle";

export default async function Navbar() {
  // Mai far crashare il layout: senza profilo si mostra "Profilo".
  const profile = await getProfile().catch(() => null);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[var(--ec-canvas)]/85 backdrop-blur-xl dark:border-slate-800/80">
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2 text-base font-black tracking-tight sm:text-lg">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-600 text-sm text-slate-950 shadow-lg shadow-amber-900/15 transition-transform group-hover:rotate-6">EC</span>
          <span>Euro<span className="text-amber-500">Collection</span></span>
        </Link>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5 text-[11px] min-[380px]:text-xs sm:gap-2 sm:text-sm">
          <Link
            href="/"
            className="shrink-0 rounded-xl px-2 py-2 text-slate-600 transition-colors hover:bg-white hover:text-slate-950 sm:px-3 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            Catalogo
          </Link>
          <Link
            href="/collezione"
            className="shrink-0 rounded-xl px-2 py-2 text-slate-600 transition-colors hover:bg-white hover:text-slate-950 sm:px-3 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <span className="hidden min-[420px]:inline">La mia collezione</span>
            <span className="min-[420px]:hidden">Collezione</span>
          </Link>
          <Link
            href="/scambi"
            className="shrink-0 rounded-xl px-2 py-2 text-slate-600 transition-colors hover:bg-white hover:text-slate-950 sm:px-3 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            Scambi
          </Link>
          <span className="shrink-0">
            <ThemeToggle />
          </span>
          <Link
            href="/profilo"
            className="min-w-0 max-w-20 truncate rounded-full bg-zinc-900 px-2 py-1.5 font-medium text-white min-[380px]:max-w-24 sm:max-w-none sm:px-3 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {profile ? `${profile.avatar} ${profile.displayName}` : "👤 Profilo"}
          </Link>
        </div>
      </nav>
    </header>
  );
}
