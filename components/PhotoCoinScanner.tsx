"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  incrementCoin,
  incrementCoinYear,
} from "@/app/actions/collection";
import { searchCoins } from "@/app/actions/recognition";
import {
  analyzeCanvas,
  analyzePixels,
  qualityMessage,
  QUALITY_SAMPLE_SIZE,
  type PhotoQuality,
} from "@/lib/photo-quality";
import {
  coinDisplayYear,
  type RecognizedCoin,
  type RecognizeResponse,
} from "@/lib/recognized";

/**
 * Aggiunta di una moneta tramite due foto guidate:
 * 1. FRONTE (lato nazionale) dentro il cerchio;
 * 2. RETRO (lato comune) dentro il cerchio;
 * 3. analisi + proposta della moneta, con conferma o correzione manuale.
 *
 * Le foto non vengono salvate: vengono solo inviate a /api/recognize.
 * La fotocamera è usata solo se disponibile e autorizzata; in ogni caso
 * restano disponibili le foto dalla galleria.
 */

type Stage = "camera" | "analyzing" | "result" | "manual" | "added";
type Side = "front" | "back";

interface Shot {
  dataUrl: string;
  quality: PhotoQuality;
}

function defaultYear(coin: RecognizedCoin): number | null {
  if (coin.isCommemorative) return coin.designYear;
  if (coin.matchedYear != null) return coin.matchedYear;
  return coin.years.length > 0
    ? coin.years[coin.years.length - 1]
    : coin.designYear;
}

function isMultiYear(coin: RecognizedCoin): boolean {
  return !coin.isCommemorative && coin.years.length > 1;
}

function cameraErrorMessage(error: unknown): string {
  const name =
    typeof DOMException !== "undefined" && error instanceof DOMException
      ? error.name
      : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Accesso alla fotocamera negato. Consenti la fotocamera nelle impostazioni del browser e riprova, oppure carica le foto dalla galleria.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Nessuna fotocamera disponibile su questo dispositivo. Puoi caricare le due foto dalla galleria.";
    case "NotReadableError":
      return "La fotocamera è occupata da un'altra app. Chiudila e riprova, oppure carica le foto dalla galleria.";
    default:
      return "Impossibile aprire la fotocamera. Controlla i permessi del browser oppure carica le foto dalla galleria.";
  }
}

function mapAddError(code: string): string {
  if (code === "UNAUTHENTICATED")
    return "Sessione scaduta: ricarica la pagina e riprova.";
  return `Non sono riuscito ad aggiungere la moneta. Dettaglio: ${code}`;
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return "Corrispondenza alta";
  if (confidence >= 0.5) return "Corrispondenza media";
  return "Corrispondenza bassa";
}

const QUALITY_TONE: Record<
  PhotoQuality["status"] | "starting",
  { dot: string; text: string; box: string }
> = {
  ready: {
    dot: "bg-emerald-400",
    text: "text-emerald-700 dark:text-emerald-300",
    box: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50",
  },
  blurry: {
    dot: "bg-amber-400",
    text: "text-amber-800 dark:text-amber-200",
    box: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50",
  },
  dark: {
    dot: "bg-amber-400",
    text: "text-amber-800 dark:text-amber-200",
    box: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50",
  },
  bright: {
    dot: "bg-amber-400",
    text: "text-amber-800 dark:text-amber-200",
    box: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50",
  },
  empty: {
    dot: "bg-amber-400",
    text: "text-amber-800 dark:text-amber-200",
    box: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50",
  },
  starting: {
    dot: "bg-zinc-400",
    text: "text-zinc-500 dark:text-zinc-400",
    box: "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/50",
  },
};

export default function PhotoCoinScanner() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("camera");
  const [side, setSide] = useState<Side>("front");
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [quality, setQuality] = useState<PhotoQuality | "starting" | null>(
    null
  );
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [captureWarning, setCaptureWarning] = useState<string | null>(null);
  const [pending, setPending] = useState<Shot | null>(null);
  const [flash, setFlash] = useState(false);
  const [candidates, setCandidates] = useState<RecognizedCoin[]>([]);
  const [selected, setSelected] = useState<RecognizedCoin | null>(null);
  const [chosenYear, setChosenYear] = useState<number | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecognizedCoin[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualSelected, setManualSelected] =
    useState<RecognizedCoin | null>(null);
  const [manualYear, setManualYear] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState<{
    coin: RecognizedCoin;
    year: number | null;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const flashTimer = useRef<number | null>(null);
  const searchSeq = useRef(0);
  // Token delle analisi: se l'utente chiude o riparte mentre il modello
  // risponde, la risposta vecchia non deve cambiare la schermata nuova.
  const recognitionSeq = useRef(0);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const close = useCallback(() => {
    recognitionSeq.current += 1;
    stopCamera();
    setOpen(false);
    setStage("camera");
    setSide("front");
    setFront(null);
    setBack(null);
    setQuality(null);
    setCameraReady(false);
    setCameraError(null);
    setCaptureWarning(null);
    setPending(null);
    setCandidates([]);
    setSelected(null);
    setChosenYear(null);
    setAnalyzeError(null);
    setQuery("");
    setResults([]);
    setSearching(false);
    setManualSelected(null);
    setManualYear(null);
    setSaving(false);
    setAddError(null);
    setAdded(null);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, [stopCamera]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Accende la fotocamera quando si è nella fase di scatto. Resta accesa
  // passando da FRONTE a RETRO (side non è una dipendenza).
  useEffect(() => {
    if (!open || stage !== "camera") return;
    let cancelled = false;
    setQuality("starting");
    setCameraError(null);
    setCameraReady(false);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError(
        "Questo browser non consente l'accesso alla fotocamera. Puoi caricare le due foto dalla galleria."
      );
      return;
    }
    if (!window.isSecureContext) {
      setCameraError(
        "La fotocamera richiede una connessione sicura (HTTPS o localhost). Apri il sito in HTTPS oppure carica le foto dalla galleria."
      );
      return;
    }

    // Se il browser lascia la richiesta di permesso appesa (nessuna risposta
    // dell'utente), non si resta bloccati su "Attivazione…": si mostra
    // subito l'alternativa con le foto dalla galleria.
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      timedOut = true;
      setCameraError(
        "La fotocamera non risponde (permesso non concesso?). Consenti l'accesso nelle impostazioni del browser e riprova, oppure carica le due foto dalla galleria."
      );
      setCameraReady(false);
    }, 12_000);

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        window.clearTimeout(timeoutId);
        if (cancelled || timedOut) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // Su iOS può servire un tocco sullo schermo: il video riparte da solo
          // al primo gesto, la UI resta utilizzabile.
        }
        if (!cancelled) setCameraReady(true);
      } catch (error) {
        window.clearTimeout(timeoutId);
        if (cancelled) return;
        console.error("[scanner] fotocamera non disponibile:", error);
        setCameraError(cameraErrorMessage(error));
        setCameraReady(false);
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      stopCamera();
      setCameraReady(false);
    };
  }, [open, stage, cameraAttempt, stopCamera]);

  // Controllo qualità live ~4 volte al secondo: nitidezza, luce, contenuto.
  useEffect(() => {
    if (!open || stage !== "camera" || !cameraReady) return;
    let alive = true;
    let frame = 0;
    let lastCheck = 0;

    const tick = (time: number) => {
      if (!alive) return;
      if (time - lastCheck >= 220) {
        lastCheck = time;
        const video = videoRef.current;
        const next = video ? measureVideo(video) : null;
        if (next) setQuality(next);
      }
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
    };
  }, [open, stage, cameraReady]);

  // Ricerca manuale con debounce (solo nella fase "manual").
  useEffect(() => {
    if (!open || stage !== "manual") return;
    const needle = query.trim();
    if (needle.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const sequence = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchCoins(needle);
        if (sequence === searchSeq.current) setResults(found);
      } finally {
        if (sequence === searchSeq.current) setSearching(false);
      }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, stage, open]);

  const startFlow = () => {
    close();
    setOpen(true);
  };

  const acceptShot = useCallback(
    (shot: Shot) => {
      setPending(null);
      setCaptureWarning(null);
      if (side === "front") {
        setFront(shot.dataUrl);
        setSide("back");
        setQuality(null);
        return;
      }
      if (!front) {
        setSide("front");
        return;
      }
      setBack(shot.dataUrl);
      void runRecognition(front, shot.dataUrl);
    },
    // runRecognition è una function declaration: stabile per questo render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [side, front]
  );

  const shoot = (force: boolean) => {
    const video = videoRef.current;
    if (!video) {
      setCaptureWarning(
        "La fotocamera non è pronta: attendi un istante e riprova."
      );
      return;
    }
    const shot = captureFromVideo(video);
    if (!shot) {
      setCaptureWarning(
        "Impossibile scattare: la fotocamera non ha ancora un'immagine. Riprova."
      );
      return;
    }
    if (!force && shot.quality.status !== "ready") {
      setCaptureWarning(qualityMessage(shot.quality.status));
      return;
    }
    setFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 170);
    acceptShot(shot);
  };

  const handleFile = async (file: File) => {
    setCaptureWarning(null);
    setPending(null);
    try {
      const shot = await shotFromFile(file);
      if (shot.quality.status === "ready") {
        acceptShot(shot);
      } else {
        setPending(shot);
        setCaptureWarning(qualityMessage(shot.quality.status));
      }
    } catch (error) {
      console.error("[scanner] lettura immagine fallita:", error);
      setCaptureWarning(
        "Impossibile leggere questa immagine: scegli un file JPEG o PNG."
      );
    }
  };

  async function runRecognition(frontImage: string, backImage: string) {
    const sequence = ++recognitionSeq.current;
    setStage("analyzing");
    setAnalyzeError(null);
    setCandidates([]);
    setSelected(null);
    setChosenYear(null);
    setAddError(null);
    try {
      const response = await fetch("/api/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: frontImage, back: backImage }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as RecognizeResponse | null;
      if (sequence !== recognitionSeq.current) return;
      if (!response.ok || !payload || !payload.ok) {
        setAnalyzeError(
          payload && !payload.ok
            ? payload.error
            : "Il riconoscimento non ha risposto. Riprova o cerca la moneta a mano."
        );
        setStage("result");
        return;
      }
      const first = payload.candidates[0] ?? null;
      setCandidates(payload.candidates);
      setSelected(first);
      setChosenYear(first ? defaultYear(first) : null);
      if (!first) {
        setAnalyzeError(
          "Non ho riconosciuto la moneta. Rifai le foto con più luce e la moneta ferma, oppure cercala a mano."
        );
      }
      setStage("result");
    } catch (error) {
      if (sequence !== recognitionSeq.current) return;
      console.error("[scanner] riconoscimento fallito:", error);
      setAnalyzeError(
        "Errore di rete durante il riconoscimento. Controlla la connessione e riprova."
      );
      setStage("result");
    }
  }

  const selectCandidate = (coin: RecognizedCoin) => {
    setSelected(coin);
    setChosenYear(defaultYear(coin));
    setAddError(null);
  };

  async function confirmCoin(coin: RecognizedCoin, year: number | null) {
    if (saving) return;
    setSaving(true);
    setAddError(null);
    try {
      const multiYear = isMultiYear(coin);
      const targetYear = multiYear ? (year ?? defaultYear(coin)) : null;
      const result =
        targetYear != null
          ? await incrementCoinYear(coin.id, targetYear)
          : await incrementCoin(coin.id);
      if (!result.ok) {
        setAddError(mapAddError(result.error));
        return;
      }
      setAdded({ coin, year: targetYear });
      setStage("added");
      router.refresh();
    } catch (error) {
      console.error("[scanner] aggiunta fallita:", error);
      setAddError("Errore di rete: la moneta non è stata aggiunta. Riprova.");
    } finally {
      setSaving(false);
    }
  }

  const openManual = () => {
    setStage("manual");
    setQuery("");
    setResults([]);
    setManualSelected(null);
    setManualYear(null);
    setAddError(null);
  };

  const chooseManual = (coin: RecognizedCoin) => {
    setManualSelected(coin);
    setManualYear(defaultYear(coin));
    setAddError(null);
  };

  const addAnother = () => {
    recognitionSeq.current += 1;
    setStage("camera");
    setSide("front");
    setFront(null);
    setBack(null);
    setQuality(null);
    setCameraReady(false);
    setCameraError(null);
    setCaptureWarning(null);
    setPending(null);
    setCandidates([]);
    setSelected(null);
    setChosenYear(null);
    setAnalyzeError(null);
    setQuery("");
    setResults([]);
    setSearching(false);
    setManualSelected(null);
    setManualYear(null);
    setSaving(false);
    setAddError(null);
    setAdded(null);
    setCameraAttempt((value) => value + 1);
  };

  const qStatus =
    quality === "starting" ? "starting" : (quality?.status ?? "starting");
  const tone = QUALITY_TONE[qStatus];
  const canShoot = cameraReady && quality !== null && quality !== "starting" && quality.status === "ready";
  const step = stage === "camera" ? (side === "front" ? 1 : 2) : stage === "analyzing" ? 2 : 3;

  return (
    <>
      <button
        type="button"
        onClick={startFlow}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
      >
        <span aria-hidden="true">📷</span>
        Aggiungi con foto
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scanner-title"
            className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:p-6 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="scanner-title" className="text-lg font-extrabold">
                  Aggiungi una moneta con due foto
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Fronte e retro: il riconoscimento propone la moneta, poi
                  confermi tu.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                autoFocus
                aria-label="Chiudi"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-lg font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                ×
              </button>
            </div>

            <ol className="mt-4 flex items-center gap-2 text-[11px] font-semibold">
              <Step n={1} label="Fronte" state={step === 1 ? "active" : front ? "done" : "todo"} />
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              <Step n={2} label="Retro" state={step === 2 ? "active" : back ? "done" : "todo"} />
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              <Step n={3} label="Conferma" state={step === 3 ? "active" : "todo"} />
            </ol>

            {stage === "camera" && renderCamera()}
            {stage === "analyzing" && renderAnalyzing()}
            {stage === "result" && renderResult()}
            {stage === "manual" && renderManual()}
            {stage === "added" && renderAdded()}
          </div>
        </div>
      )}
    </>
  );

  function renderCamera() {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold">
              {side === "front"
                ? "1. Inquadra il FRONTE nel cerchio"
                : "2. Ora inquadra il RETRO nel cerchio"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {side === "front"
                ? "È il lato nazionale: il disegno del paese e l'anno. Appoggia la moneta su un piano e avvicinati."
                : "È il lato comune: la mappa dell'Europa con il valore. Tieni la stessa distanza."}
            </p>
          </div>
          {side === "back" && front && (
            <button
              type="button"
              onClick={() => {
                setFront(null);
                setSide("front");
                setCaptureWarning(null);
              }}
              className="shrink-0 text-[11px] font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
            >
              Rifai il fronte
            </button>
          )}
        </div>

        {/* Il cerchio resta quadrato ma si rimpicciolisce sui telefoni bassi,
            così lo scatto e la galleria non finiscono fuori schermo. */}
        <div className="relative mx-auto aspect-square w-[min(100%,340px,42dvh)] overflow-hidden rounded-[2rem] bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
          />
          {!cameraReady && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 text-center text-xs text-zinc-300">
              <span className="text-2xl" aria-hidden="true">📷</span>
              Attivazione della fotocamera…
            </div>
          )}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 p-6 text-center text-xs text-zinc-200">
              <span className="text-2xl" aria-hidden="true">🚫</span>
              <p>{cameraError}</p>
            </div>
          )}
          {cameraReady && (
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <div
                className={`absolute inset-[6%] rounded-full border-[3px] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ${
                  qStatus === "ready"
                    ? "border-emerald-400"
                    : qStatus === "blurry" || qStatus === "empty"
                      ? "border-amber-300"
                      : "border-white/80"
                }`}
              />
              <div className="absolute left-1/2 top-[9%] -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 text-[11px] font-bold tracking-[0.22em] text-white">
                {side === "front" ? "FRONTE" : "RETRO"}
              </div>
              <div className="absolute bottom-[9%] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-3 py-1 text-[10px] font-medium text-white">
                La moneta deve riempire il cerchio
              </div>
            </div>
          )}
          {flash && (
            <div className="absolute inset-0 bg-white/80" />
          )}
        </div>

        {cameraReady && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${tone.box} ${tone.text}`}
          >
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
              aria-hidden="true"
            />
            <span>
              {qStatus === "starting"
                ? "Metti a fuoco la moneta…"
                : qualityMessage(qStatus)}
            </span>
          </div>
        )}

        {captureWarning && (
          <p
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
          >
            {captureWarning}
          </p>
        )}

        {pending && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pending.dataUrl}
                alt="Anteprima della foto caricata"
                className="h-16 w-16 rounded-lg object-cover"
              />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                La foto caricata non è nitida. Puoi sceglierne un&apos;altra
                oppure usarla comunque.
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  setCaptureWarning(null);
                }}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm dark:bg-zinc-800 dark:text-zinc-200"
              >
                Scegli un&apos;altra foto
              </button>
              <button
                type="button"
                onClick={() => acceptShot(pending)}
                className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
              >
                Usa comunque
              </button>
            </div>
          </div>
        )}

        {(front || back) && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 p-2 text-[11px] dark:bg-zinc-800/60">
            <div className="flex items-center gap-2">
              {front && <ShotThumb src={front} label="Fronte" />}
              {back && <ShotThumb src={back} label="Retro" />}
            </div>
            {front && back && (
              <button
                type="button"
                onClick={() => void runRecognition(front, back)}
                className="rounded-full bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500"
              >
                Analizza le foto
              </button>
            )}
          </div>
        )}

        {/* Azioni sempre raggiungibili: restano ancorate in basso mentre le
            avvertenze scorrono sopra. */}
        <div className="sticky bottom-0 z-10 flex flex-col gap-2 bg-white/95 pt-2 backdrop-blur-sm dark:bg-zinc-900/95">
          <button
            type="button"
            onClick={() => shoot(false)}
            disabled={!canShoot}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-zinc-900 text-sm font-bold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            <span aria-hidden="true">◉</span>
            {side === "front" ? "Scatta il FRONTE" : "Scatta il RETRO"}
          </button>

          {cameraReady && !canShoot && qStatus !== "starting" && (
            <button
              type="button"
              onClick={() => shoot(true)}
              className="text-xs font-semibold text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              Scatta comunque (foto non ottimale)
            </button>
          )}

          {cameraError && (
            <button
              type="button"
              onClick={() => setCameraAttempt((value) => value + 1)}
              className="text-xs font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
            >
              Riprova ad aprire la fotocamera
            </button>
          )}

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full border border-zinc-300 px-4 py-2.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <span aria-hidden="true">🖼️</span>
            {side === "front"
              ? "Carica il FRONTE dalla galleria"
              : "Carica il RETRO dalla galleria"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>

          <p className="text-center text-[10px] leading-4 text-zinc-400">
            Le foto vengono inviate al servizio di riconoscimento e non sono
            salvate nel tuo account.
          </p>
        </div>
      </div>
    );
  }

  function renderAnalyzing() {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-200 border-t-emerald-500 dark:border-zinc-700 dark:border-t-emerald-400" />
        <div>
          <p className="text-sm font-bold">Sto riconoscendo la moneta…</p>
          <p className="mt-1 text-xs text-zinc-500">
            Confronto il fronte e il retro con il catalogo delle monete euro.
          </p>
        </div>
        {(front || back) && (
          <div className="flex items-center gap-3">
            {front && <ShotThumb src={front} label="Fronte" />}
            {back && <ShotThumb src={back} label="Retro" />}
          </div>
        )}
      </div>
    );
  }

  function renderResult() {
    const coin = selected ?? candidates[0] ?? null;
    return (
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {front && <ShotThumb src={front} label="Fronte" />}
            {back && <ShotThumb src={back} label="Retro" />}
          </div>
          <p className="text-xs text-zinc-500">
            {coin
              ? "Ho trovato questa moneta. Controlla che sia giusta prima di aggiungerla."
              : "Il riconoscimento non ha prodotto una proposta."}
          </p>
        </div>

        {analyzeError && (
          <p
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
          >
            {analyzeError}
          </p>
        )}

        {coin && (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
            <div className="flex gap-3">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-white dark:bg-zinc-900">
                <Image
                  src={coin.url}
                  alt={`${coin.faceValue} ${coin.countryName}`}
                  fill
                  sizes="96px"
                  className="object-contain p-1"
                />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  {confidenceLabel(coin.confidence)}
                </p>
                <h3 className="mt-0.5 text-lg font-extrabold leading-tight">
                  {coin.faceValue} · {coin.countryName}
                </h3>
                <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                  {`Anno ${
                    isMultiYear(coin) && chosenYear != null
                      ? chosenYear
                      : coinDisplayYear(coin)
                  }`}
                  {coin.isCommemorative ? " · Commemorativo" : " · Divisionale"}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                  {coin.description}
                </p>
              </div>
            </div>

            {isMultiYear(coin) && (
              <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                Anno della moneta
                <select
                  value={chosenYear ?? ""}
                  onChange={(event) => setChosenYear(Number(event.target.value))}
                  className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900"
                >
                  {[...coin.years].reverse().map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {candidates.length > 1 && (
              <div className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                <p className="mb-1 text-[11px] font-semibold text-zinc-500">
                  Non è questa? Altre possibilità:
                </p>
                <div className="flex flex-col gap-1">
                  {candidates
                    .filter((candidate) => candidate.id !== coin.id)
                    .map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => selectCandidate(candidate)}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white dark:hover:bg-zinc-900"
                      >
                        <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white dark:bg-zinc-800">
                          <Image
                            src={candidate.url}
                            alt=""
                            fill
                            sizes="32px"
                            className="object-contain p-0.5"
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                          {candidate.faceValue} · {candidate.countryName} ·{" "}
                          {candidate.isCommemorative
                            ? candidate.designYear
                            : `Divisionale ${candidate.designYear}`}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {addError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
          >
            {addError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {coin && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void confirmCoin(coin, chosenYear)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? "Aggiunta in corso…" : "✓ Conferma e aggiungi"}
            </button>
          )}
          <button
            type="button"
            onClick={openManual}
            className="rounded-full border border-zinc-300 px-4 py-2.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            ✕ Hai sbagliato moneta? Cercala a mano
          </button>
          <button
            type="button"
            onClick={addAnother}
            className="text-xs font-semibold text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            Rifai le foto
          </button>
        </div>
      </div>
    );
  }

  function renderManual() {
    const coin = manualSelected;
    return (
      <div className="mt-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-bold">Cerca la moneta giusta</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Cerca per paese, anno, valore o tema (es. “Italia 2 euro 2004”,
            “Torino”, “50 cent Francia”).
          </p>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cerca nel catalogo…"
          aria-label="Cerca la moneta nel catalogo"
          className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />

        {searching && (
          <p className="text-center text-xs text-zinc-500">Ricerca…</p>
        )}
        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
            Nessuna moneta trovata. Prova con il paese e il valore (es. “Italia
            2 euro”).
          </p>
        )}

        {results.length > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
            {results.map((result) => {
              const active = coin?.id === result.id;
              return (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => chooseManual(result)}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2 border-b border-zinc-100 px-2 py-1.5 text-left last:border-b-0 ${
                    active
                      ? "bg-emerald-50 dark:bg-emerald-950/40"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white dark:bg-zinc-800">
                    <Image
                      src={result.url}
                      alt=""
                      fill
                      sizes="36px"
                      className="object-contain p-0.5"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">
                      {result.faceValue} · {result.countryName} ·{" "}
                      {result.designYear}
                    </span>
                    <span className="block truncate text-[10px] text-zinc-500">
                      {result.description}
                    </span>
                  </span>
                  {active && (
                    <span className="text-xs font-bold text-emerald-600">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {coin && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
              Hai scelto: {coin.faceValue} · {coin.countryName}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
              {coin.description}
            </p>
            {isMultiYear(coin) && (
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                Anno
                <select
                  value={manualYear ?? ""}
                  onChange={(event) =>
                    setManualYear(Number(event.target.value))
                  }
                  className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900"
                >
                  {[...coin.years].reverse().map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {addError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
          >
            {addError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {coin && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void confirmCoin(coin, manualYear)}
              className="flex h-12 w-full items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? "Aggiunta in corso…" : "✓ Aggiungi questa moneta"}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              setStage(candidates.length > 0 || analyzeError ? "result" : "camera")
            }
            className="rounded-full border border-zinc-300 px-4 py-2.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            ← Torna indietro
          </button>
        </div>
      </div>
    );
  }

  function renderAdded() {
    if (!added) return null;
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl dark:bg-emerald-950">
          ✓
        </span>
        <div>
          <h3 className="text-lg font-extrabold">Moneta aggiunta!</h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            {added.coin.faceValue} · {added.coin.countryName}
            {added.year != null ? ` · ${added.year}` : ""}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            La trovi nella tua collezione (anche nei doppioni).
          </p>
        </div>
        {added.coin.url && (
          <div className="relative h-24 w-24 overflow-hidden rounded-full bg-white dark:bg-zinc-800">
            <Image
              src={added.coin.url}
              alt={`${added.coin.faceValue} ${added.coin.countryName}`}
              fill
              sizes="96px"
              className="object-contain p-1"
            />
          </div>
        )}
        <div className="mt-1 flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={addAnother}
            className="flex h-11 w-full items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Aggiungi un&apos;altra moneta
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-full border border-zinc-300 px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Chiudi
          </button>
        </div>
      </div>
    );
  }
}

function Step({
  n,
  label,
  state,
}: {
  n: number;
  label: string;
  state: "todo" | "active" | "done";
}) {
  return (
    <li
      className={`flex items-center gap-1.5 ${
        state === "active"
          ? "text-emerald-700 dark:text-emerald-400"
          : state === "done"
            ? "text-zinc-700 dark:text-zinc-200"
            : "text-zinc-400"
      }`}
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
          state === "done"
            ? "bg-emerald-600 text-white"
            : state === "active"
              ? "bg-emerald-600 text-white"
              : "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300"
        }`}
        aria-hidden="true"
      >
        {state === "done" ? "✓" : n}
      </span>
      {label}
    </li>
  );
}

function ShotThumb({ src, label }: { src: string; label: string }) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Foto ${label.toLowerCase()}`}
        className="h-12 w-12 rounded-lg object-cover ring-2 ring-emerald-500/70"
      />
      <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
    </span>
  );
}

/** Copia il quadrato centrale del video (la zona del cerchio) in un JPEG 900×900. */
function captureFromVideo(video: HTMLVideoElement): Shot | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const crop = Math.min(width, height) * 0.9;
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 900;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(
    video,
    (width - crop) / 2,
    (height - crop) / 2,
    crop,
    crop,
    0,
    0,
    900,
    900
  );
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.87),
    quality: analyzeCanvas(canvas),
  };
}

/** Stessa normalizzazione per una foto scelta dalla galleria. */
async function shotFromFile(file: File): Promise<Shot> {
  if (!file.type.startsWith("image/")) throw new Error("NOT_IMAGE");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = document.createElement("img");
    image.src = objectUrl;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("EMPTY_IMAGE");
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 900;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("NO_CANVAS");
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      900,
      900
    );
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.87),
      quality: analyzeCanvas(canvas),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Campiona il centro del video a 220×220 e calcola le metriche. */
function measureVideo(video: HTMLVideoElement): PhotoQuality | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const crop = Math.min(width, height) * 0.9;
  const canvas = document.createElement("canvas");
  canvas.width = QUALITY_SAMPLE_SIZE;
  canvas.height = QUALITY_SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(
    video,
    (width - crop) / 2,
    (height - crop) / 2,
    crop,
    crop,
    0,
    0,
    QUALITY_SAMPLE_SIZE,
    QUALITY_SAMPLE_SIZE
  );
  const data = context.getImageData(
    0,
    0,
    QUALITY_SAMPLE_SIZE,
    QUALITY_SAMPLE_SIZE
  ).data;
  return analyzePixels(data, QUALITY_SAMPLE_SIZE, QUALITY_SAMPLE_SIZE);
}
