#!/usr/bin/env node
/**
 * Tiene aggiornato il catalogo delle monete.
 *
 * Cosa fa, in ordine:
 *  1. dice se `@euro-coins/source` ha una versione più nuova di quella usata
 *     (il range `^0.4.0` NON prende la 0.5.0: serve un bump esplicito);
 *  2. legge le pagine BCE per anno (comm_YYYY.en.html) e trova le monete che
 *     la BCE ha pubblicato ma che il pacchetto non contiene ancora;
 *  3. le scrive in `data/coins-extra.json` (overlay letto da lib/catalog.ts),
 *     con id stabile: `paese-anno-taglio-tipo-indice`;
 *  4. segnala le voci dell'overlay ormai entrate nel pacchetto, da rimuovere.
 *
 * Uso:
 *   node scripts/coins-sync.mjs            # solo diagnosi, non scrive
 *   node scripts/coins-sync.mjs --write    # aggiorna data/coins-extra.json
 *   node scripts/coins-sync.mjs --check    # exit 1 se c'è qualcosa da fare
 *
 * Solo moduli di Node: nessuna dipendenza da installare, nessun segreto.
 * La fonte è la stessa da cui nasce il pacchetto, quindi gli URL delle
 * immagini restano quelli che la UI si aspetta (next.config.ts).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OVERLAY_PATH = join(ROOT, "data", "coins-extra.json");
const PACKAGE_NAME = "@euro-coins/source";
const ECB_BASE = "https://www.ecb.europa.eu/euro/coins/comm/html";
const USER_AGENT = "EuroCollection-catalog-sync/1.0 (+https://euro-collection.vercel.app)";

const WRITE = process.argv.includes("--write");
const CHECK = process.argv.includes("--check");

/** Regola UE: massimo due €2 commemorative per paese e anno. */
const MAX_COMMEMORATIVES_PER_YEAR = 2;

/** Nomi di paese usati dalla BCE nei nomi file → codice ISO. */
const ECB_COUNTRY_NAMES = {
  andorra: "ad",
  austria: "at",
  belgium: "be",
  bulgaria: "bg",
  croatia: "hr",
  cyprus: "cy",
  estonia: "ee",
  finland: "fi",
  france: "fr",
  germany: "de",
  greece: "gr",
  ireland: "ie",
  italy: "it",
  latvia: "lv",
  lithuania: "lt",
  luxembourg: "lu",
  malta: "mt",
  monaco: "mc",
  netherlands: "nl",
  portugal: "pt",
  "san marino": "sm",
  slovakia: "sk",
  slovenia: "si",
  spain: "es",
  vatican: "va",
  "vatican city": "va",
};

function fetchText(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { "user-agent": USER_AGENT } }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
        res.resume();
        resolve(fetchText(new URL(location, url).toString(), redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
  });
}

/** `Italy_540x540.jpg` → `it`; `placeholder_coming_soon%20(1).jpg` → null. */
function countryFromFileName(fileName) {
  const base = decodeURIComponent(fileName)
    .replace(/\.(jpe?g|png)$/i, "")
    .replace(/[_-]?\d+x\d+$/i, "")
    .replace(/\d+$/, "");
  const key = base.toLowerCase().replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  if (!key || key.includes("placeholder")) return null;
  if (ECB_COUNTRY_NAMES[key]) return ECB_COUNTRY_NAMES[key];
  for (const [name, code] of Object.entries(ECB_COUNTRY_NAMES)) {
    if (key.startsWith(name)) return code;
  }
  return null;
}

/** Estrae le immagini delle monete da una pagina BCE annuale. */
export function parseYearPage(html, year) {
  const pattern = new RegExp(`comm_${year}/([^"'\\s>]+\\.(?:jpe?g|png))`, "gi");
  const found = [];
  const seen = new Set();
  for (const match of html.matchAll(pattern)) {
    const fileName = match[1].split("/").pop();
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    const country = countryFromFileName(fileName);
    if (!country) continue;
    found.push({
      country,
      year,
      fileName,
      url: `${ECB_BASE}/comm_${year}/${fileName}`,
    });
  }
  return found;
}

function coinId({ country, year, denomination, type, index }) {
  return `${country}-${year}-${denomination}-${type}-${index}`;
}

/**
 * Decide quali immagini BCE sono monete che il catalogo non ha ancora.
 *
 * Perché non basta confrontare i nomi file: BCE e pacchetto usano nomi
 * diversi per la stessa moneta (Germany.jpg vs Germany540x540.jpg), e la
 * pagina BCE mostra solo l'immagine, non l'indice. Si confrontano quindi le
 * QUANTITÀ per paese e anno: si propone qualcosa solo quando la BCE mostra
 * più disegni di quanti il catalogo ne conosca. Meglio non aggiungere che
 * aggiungere un doppione: ogni voce qui è un tasto della collezione.
 */
export function planNewCoins(found, catalogCoins) {
  const commemoratives = catalogCoins.filter(
    (coin) => coin.denomination === "2euro" && coin.type === "commemorative"
  );
  // La chiave è (paese, file): nomi generici come IMG_0135 sono usati da
  // paesi diversi, quindi il solo nome file darebbe falsi positivi.
  const knownFiles = new Set(
    commemoratives
      .map((coin) =>
        coin.url ? `${coin.country}/${coin.url.split("/").pop()}` : null
      )
      .filter(Boolean)
  );

  const byCountry = new Map();
  for (const image of found) {
    const list = byCountry.get(image.country) ?? [];
    list.push(image);
    byCountry.set(image.country, list);
  }

  const plan = [];
  for (const [country, images] of byCountry) {
    const year = images[0].year;
    const existing = commemoratives.filter(
      (coin) => coin.country === country && coin.year === year
    );
    // Regola UE: al massimo due commemorative per paese e anno. Se il
    // catalogo ne ha già due, non si propone nulla.
    const shown = Math.min(images.length, MAX_COMMEMORATIVES_PER_YEAR);
    const uncovered = images
      .filter((image) => !knownFiles.has(`${country}/${image.fileName}`))
      .slice(0, Math.max(0, shown - existing.length));

    let nextIndex = existing.length
      ? Math.max(...existing.map((coin) => coin.index ?? 0)) + 1
      : 0;
    for (const image of uncovered) {
      plan.push({
        country,
        year,
        denomination: "2euro",
        type: "commemorative",
        index: nextIndex,
        url: image.url,
      });
      nextIndex += 1;
    }
  }
  return plan;
}

async function loadPackageCoins() {
  const entry = join(ROOT, "node_modules", PACKAGE_NAME, "dist", "index.js");
  if (!existsSync(entry)) return null;
  const mod = await import(pathToFileURL(entry).href);
  return mod.getAllCoins();
}

function readOverlay() {
  const raw = JSON.parse(readFileSync(OVERLAY_PATH, "utf8"));
  return Array.isArray(raw.coins) ? raw : { ...raw, coins: [] };
}

async function latestPublishedVersion() {
  const body = await fetchText(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`);
  if (!body) return null;
  try {
    return JSON.parse(body).version ?? null;
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function main() {
  const pkgJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const declared = pkgJson.dependencies?.[PACKAGE_NAME] ?? "?";
  const installedEntry = join(ROOT, "node_modules", PACKAGE_NAME, "package.json");
  const installed = existsSync(installedEntry)
    ? JSON.parse(readFileSync(installedEntry, "utf8")).version
    : null;

  console.log(`Pacchetto ${PACKAGE_NAME}`);
  console.log(`  dichiarato: ${declared} · installato: ${installed ?? "non installato"}`);

  const latest = await latestPublishedVersion().catch((error) => {
    console.log(`  npm: errore di rete (${error.message})`);
    return null;
  });
  if (!latest) {
    console.log("  npm: versione non verificata (si continua con la BCE)");
  } else if (installed && compareVersions(latest, installed) > 0) {
    console.log(`  npm: esce la ${latest} (più nuova della ${installed})`);
    console.log(`  → npm install ${PACKAGE_NAME}@${latest}   # il range ${declared} non la prende da solo`);
  } else {
    console.log(`  npm: ${latest} è la più recente, niente da aggiornare`);
  }

  const overlay = readOverlay();
  const extra = overlay.coins;
  const pkgCoins = await loadPackageCoins();
  if (!pkgCoins) {
    console.log("\nnode_modules assente: confronto limitato all'overlay");
  }

  const catalogCoins = [...(pkgCoins ?? []), ...extra];

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1];
  const proposals = [];
  const pendingYears = [];

  console.log("\nPagine BCE per anno");
  const failures = [];
  for (const year of years) {
    const url = `${ECB_BASE}/comm_${year}.en.html`;
    let html = null;
    try {
      html = await fetchText(url);
    } catch (error) {
      // TLS/rete: non è "pagina assente", va detto per non mentire.
      failures.push(`${year}: ${error.message}`);
      console.log(`  ${year}: errore di rete (${error.message})`);
      continue;
    }
    if (!html) {
      pendingYears.push(year);
      console.log(`  ${year}: pagina non ancora pubblicata → niente da aggiungere`);
      continue;
    }
    const found = parseYearPage(html, year);
    const plan = planNewCoins(found, catalogCoins);
    console.log(
      `  ${year}: ${found.length} immagini sulla pagina, ${plan.length} monete nuove`
    );
    proposals.push(...plan);
  }

  // Voci dell'overlay ormai entrate nel pacchetto ufficiale (confronto per id).
  const packageIds = new Set((pkgCoins ?? []).map((coin) => coinId(coin)));
  const stale = extra.filter((coin) =>
    packageIds.has(coinId({ ...coin, index: coin.index ?? 0 }))
  );

  if (proposals.length) {
    console.log("\nDa aggiungere a data/coins-extra.json:");
    for (const coin of proposals) {
      console.log(`  ${coinId(coin)}  →  ${coin.url}`);
    }
  }

  if (stale.length) {
    console.log("\nOrmai nel pacchetto (togliere dall'overlay, la voce ufficiale basta):");
    for (const coin of stale) console.log(`  ${coinId({ ...coin, index: coin.index ?? 0 })}`);
  }

  if (pendingYears.length) {
    console.log(
      `\nLa BCE non pubblica ancora il ${pendingYears.join(" e il ")}: si aggiorna da sola appena esce la pagina.`
    );
  }

  if (WRITE && proposals.length) {
    const merged = { ...overlay, coins: [...extra, ...proposals] };
    writeFileSync(OVERLAY_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    console.log(`\ndata/coins-extra.json aggiornato: +${proposals.length} monete`);
  } else if (proposals.length) {
    console.log("\nNessuna scrittura: rilancia con --write per aggiornare l'overlay");
  } else {
    console.log("\nCatalogo già allineato alla fonte BCE.");
  }

  if (failures.length) {
    console.log("\nRete: alcune pagine non sono state lette (vedi sopra).");
  }

  if (CHECK && (proposals.length || stale.length || failures.length)) process.exit(1);
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((error) => {
    console.error("Errore durante la sincronizzazione:", error);
    process.exit(1);
  });
}
