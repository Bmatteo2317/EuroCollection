import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import Navbar from "@/components/Navbar";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "EuroCollection — Catalogo e collezione monete Euro",
  description:
    "Catalogo statico di tutte le monete euro (BCE) + collezione privata con Neon. Italia, Finlandia, Germania e tutta l'Eurozona.",
  applicationName: "EuroCollection",
  appleWebApp: {
    capable: true,
    title: "EuroCollection",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-[var(--ec-canvas)] text-[var(--ec-ink)] selection:bg-amber-200 selection:text-slate-950 dark:selection:bg-amber-900 dark:selection:text-white">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
        >{`(function(){try{var t=localStorage.getItem('euro-theme');if(t!=='light'){document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}})()`}</Script>
        <ServiceWorkerRegister />
        <Navbar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
          {children}
        </main>
        <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
          Dati e immagini: Banca Centrale Europea via{" "}
          <code>@euro-coins/source</code> · Collezione privata su Neon ·
          Deploy su Vercel ⚡
        </footer>
      </body>
    </html>
  );
}
