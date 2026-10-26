"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const KEY = "euro-theme";

/**
 * Interruttore tema chiaro/scuro. Default: scuro. La scelta vive in
 * localStorage; lo script pre-paint nel layout applica la classe prima
 * del primo render per evitare flash.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    try {
      setTheme(localStorage.getItem(KEY) === "light" ? "light" : "dark");
    } catch {
      /* storage non disponibile: resta scuro */
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignora */
    }
  }, [theme ]);

  return (
    <button
      type="button"
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      aria-label={theme === "dark" ? "Passa al tema chiaro" : "Passa al tema scuro"}
      title={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
      className="flex size-9 items-center justify-center rounded-full text-base transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
