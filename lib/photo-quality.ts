/**
 * Controllo qualità delle foto della moneta, eseguito nel browser.
 *
 * Scopo: avvisare PRIMA dello scatto quando la foto è sfuocata, troppo
 * scura/luminosa o non c'è nulla dentro il cerchio. Le metriche sono
 * volutamente semplici e veloci (girano a ogni frame della anteprima):
 * - luminanza media → esposizione;
 * - deviazione standard → presenza di contenuto (un muro vuoto è piatto);
 * - RMS del Laplaciano dentro il cerchio → nitidezza (bassa = sfocatura).
 */

export const QUALITY_SAMPLE_SIZE = 220;

export type PhotoQualityStatus =
  | "ready"
  | "blurry"
  | "dark"
  | "bright"
  | "empty";

export interface PhotoQuality {
  status: PhotoQualityStatus;
  /** RMS del Laplaciano: più alto = più dettaglio/nitidezza. */
  sharpness: number;
  /** Luminanza media 0..255. */
  brightness: number;
  /** Deviazione standard della luminanza 0..~128. */
  contrast: number;
}

/** Soglie tarate su un campione quadrato di 220 px.
 *
 * `minSharpness` è il punto delicato: su una foto reale a fuoco il RMS del
 * Laplaciano sta sopra 60, mentre una messa a fuoco molle (blur ~5 px sul
 * fotogramma) scende sotto 12. Con 8 una foto visibilmente sfocata passava
 * come "pronta"; 16 la blocca lasciando passare le foto appena morbide.
 */
export const QUALITY_THRESHOLDS = {
  minSharpness: 16,
  minContrast: 6,
  minBrightness: 32,
  maxBrightness: 235,
} as const;

export function analyzePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number
): PhotoQuality {
  const total = width * height;
  const gray = new Float32Array(total);
  let sum = 0;
  let sumSquares = 0;

  for (let i = 0; i < total; i++) {
    const offset = i * 4;
    const value =
      0.299 * data[offset] +
      0.587 * data[offset + 1] +
      0.114 * data[offset + 2];
    gray[i] = value;
    sum += value;
    sumSquares += value * value;
  }

  const mean = total > 0 ? sum / total : 0;
  const variance = total > 0 ? Math.max(0, sumSquares / total - mean * mean) : 0;
  const contrast = Math.sqrt(variance);

  // Laplaciano solo dentro il cerchio guida (raggio ~44% del lato).
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radius = Math.min(width, height) * 0.44;
  const radiusSquared = radius * radius;
  let laplacianSquares = 0;
  let samples = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const i = y * width + x;
      const laplacian =
        4 * gray[i] -
        gray[i - 1] -
        gray[i + 1] -
        gray[i - width] -
        gray[i + width];
      laplacianSquares += laplacian * laplacian;
      samples++;
    }
  }

  const sharpness =
    samples > 0 ? Math.sqrt(laplacianSquares / samples) : 0;

  let status: PhotoQualityStatus = "ready";
  if (mean < QUALITY_THRESHOLDS.minBrightness) status = "dark";
  else if (contrast < QUALITY_THRESHOLDS.minContrast) status = "empty";
  else if (mean > QUALITY_THRESHOLDS.maxBrightness) status = "bright";
  else if (sharpness < QUALITY_THRESHOLDS.minSharpness) status = "blurry";

  return { status, sharpness, brightness: mean, contrast };
}

/** Analizza un canvas qualsiasi ridimensionandolo a 220×220. */
export function analyzeCanvas(canvas: HTMLCanvasElement): PhotoQuality {
  const sample = document.createElement("canvas");
  sample.width = QUALITY_SAMPLE_SIZE;
  sample.height = QUALITY_SAMPLE_SIZE;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return { status: "empty", sharpness: 0, brightness: 0, contrast: 0 };
  }
  context.drawImage(
    canvas,
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

/** Messaggio breve e azionabile per ogni stato. */
export function qualityMessage(status: PhotoQualityStatus): string {
  switch (status) {
    case "blurry":
      return "Foto sfuocata: appoggia il telefono, avvicinati e tocca la moneta per mettere a fuoco.";
    case "dark":
      return "Foto troppo scura: serve più luce sulla moneta.";
    case "bright":
      return "Foto troppo luminosa: evita riflessi e flash diretti.";
    case "empty":
      return "Nessuna moneta riconoscibile nel cerchio: centra la moneta e riempi il cerchio.";
    case "ready":
    default:
      return "Nitida: puoi scattare.";
  }
}
