import { NextResponse, type NextRequest } from "next/server";
import {
  DEVICE_COOKIE_NAME,
  deviceCookieOptions,
  isValidDeviceId,
} from "@/lib/device-cookie";

/**
 * Assegna il cookie di identità del dispositivo alla prima richiesta.
 *
 * Perché qui e non nelle pagine: in Next 16 i cookie si possono modificare
 * solo in un Server Action o in un Route Handler. Le pagine personali
 * (/collezione, /scambi) hanno bisogno dell'ID durante il render per
 * leggere la collezione, e finché nessuno impostava il cookie ogni visita
 * creava un nuovo account e la pagina finiva nello stato "database non
 * disponibile".
 *
 * Ordine dei fatti: il proxy mette il cookie SIA nella risposta (il browser
 * lo memorizza) SIA negli header della richiesta inoltrata, così il render
 * della stessa richiesta lo vede già tramite `cookies()` e non deve
 * scriverlo.
 */

export function proxy(request: NextRequest): NextResponse {
  const existing = request.cookies.get(DEVICE_COOKIE_NAME)?.value;
  // Cookie assente o non valido: se ne genera uno nuovo (l'account viene
  // creato alla prima query, vedi lib/auth.ts).
  if (existing && isValidDeviceId(existing)) return NextResponse.next();

  const id = crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  const incoming = request.headers.get("cookie");
  requestHeaders.set(
    "cookie",
    incoming
      ? `${incoming}; ${DEVICE_COOKIE_NAME}=${id}`
      : `${DEVICE_COOKIE_NAME}=${id}`
  );

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.cookies.set(DEVICE_COOKIE_NAME, id, deviceCookieOptions());
  return response;
}

export const config = {
  // Solo le pagine: niente API, asset statici, immagini ottimizzate o file
  // con estensione (favicon, sw.js, manifest…).
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
