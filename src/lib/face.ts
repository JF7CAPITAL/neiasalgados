import type * as FaceApi from "@vladmandic/face-api";

const MODEL_URL = "/models";

type FaceInput = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
type DetectorKind = "tiny" | "ssd";

let apiPromise: Promise<typeof FaceApi> | null = null;
let baseModelsPromise: Promise<void> | null = null;
let ssdModelPromise: Promise<void> | null = null;

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFace {
  descriptor: number[];
  box: FaceBox;
  score: number;
}

export interface GalleryFace {
  faceId: string;
  collaboratorId: string;
  collaboratorName: string;
  descriptor: number[];
}

export interface FaceMatch {
  face: GalleryFace;
  distance: number;
  secondDistance: number | null;
}

export const MATCH_THRESHOLD = 0.55;
export const MATCH_MARGIN = 0.04;

async function getFaceApi(): Promise<typeof FaceApi> {
  if (!apiPromise) {
    apiPromise = import("@vladmandic/face-api");
  }
  return apiPromise;
}

async function ensureBaseModels(api: typeof FaceApi): Promise<void> {
  if (!baseModelsPromise) {
    baseModelsPromise = (async () => {
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      await warmUp(api);
    })().catch((error) => {
      baseModelsPromise = null;
      throw error;
    });
  }
  return baseModelsPromise;
}

async function ensureSsdModel(api: typeof FaceApi): Promise<void> {
  if (!ssdModelPromise) {
    ssdModelPromise = api.nets.ssdMobilenetv1.loadFromUri(MODEL_URL).catch((error) => {
      ssdModelPromise = null;
      throw error;
    });
  }
  return ssdModelPromise;
}

async function warmUp(api: typeof FaceApi): Promise<void> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx?.fillRect(0, 0, canvas.width, canvas.height);
    await api.detectSingleFace(
      canvas,
      new api.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.9 }),
    );
  } catch {
    // warm-up é best-effort
  }
}

export async function loadFaceModels(detector: DetectorKind = "tiny"): Promise<void> {
  const api = await getFaceApi();
  await ensureBaseModels(api);
  if (detector === "ssd") await ensureSsdModel(api);
}

function detectorOptions(api: typeof FaceApi, detector: DetectorKind) {
  if (detector === "ssd") {
    return new api.SsdMobilenetv1Options({ minConfidence: 0.5 });
  }
  return new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 });
}

/** Detecta o maior rosto do frame e devolve o descritor de 128 dimensões. */
export async function detectLargestFace(
  input: FaceInput,
  detector: DetectorKind = "tiny",
): Promise<DetectedFace | null> {
  const api = await getFaceApi();
  await loadFaceModels(detector);

  const results = await api
    .detectAllFaces(input as never, detectorOptions(api, detector))
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (!results.length) return null;

  let best = results[0];
  let bestArea = best.detection.box.width * best.detection.box.height;
  for (const result of results.slice(1)) {
    const area = result.detection.box.width * result.detection.box.height;
    if (area > bestArea) {
      best = result;
      bestArea = area;
    }
  }

  const box = best.detection.box;
  return {
    descriptor: Array.from(best.descriptor),
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    score: best.detection.score,
  };
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Compara o descritor com a galeria. Usa a menor distância por colaborador
 * (evita que 3 amostras da mesma pessoa ocupem 1º e 2º lugar) e exige
 * margem sobre o segundo colaborador mais próximo.
 */
export function findBestMatch(
  descriptor: number[],
  gallery: GalleryFace[],
  threshold = MATCH_THRESHOLD,
  margin = MATCH_MARGIN,
): FaceMatch | null {
  if (!descriptor.length || !gallery.length) return null;

  const bestPerCollaborator = new Map<string, { face: GalleryFace; distance: number }>();
  for (const face of gallery) {
    const distance = euclideanDistance(descriptor, face.descriptor);
    if (!Number.isFinite(distance)) continue;
    const current = bestPerCollaborator.get(face.collaboratorId);
    if (!current || distance < current.distance) {
      bestPerCollaborator.set(face.collaboratorId, { face, distance });
    }
  }

  const ranked = Array.from(bestPerCollaborator.values()).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (!best || best.distance > threshold) return null;

  const second = ranked[1];
  if (second && second.distance - best.distance < margin) return null;

  return {
    face: best.face,
    distance: best.distance,
    secondDistance: second?.distance ?? null,
  };
}

function mediaSize(input: FaceInput): { width: number; height: number } {
  if (input instanceof HTMLVideoElement) {
    return { width: input.videoWidth, height: input.videoHeight };
  }
  if (input instanceof HTMLImageElement) {
    return {
      width: input.naturalWidth || input.width,
      height: input.naturalHeight || input.height,
    };
  }
  return { width: input.width, height: input.height };
}

/**
 * Recorta o rosto com margem e comprime em JPEG (quadrado).
 * 320px @ 0.65 fica entre 15 e 35 KB, ideal para o bucket ponto-fotos.
 */
export async function cropFaceBlob(
  input: FaceInput,
  box: FaceBox,
  size = 320,
  quality = 0.65,
): Promise<Blob> {
  const media = mediaSize(input);
  if (!media.width || !media.height) throw new Error("Frame da câmera indisponível.");

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const side = Math.max(box.width, box.height) * 1.7;

  const sx = Math.max(0, centerX - side / 2);
  const sy = Math.max(0, centerY - side / 2);
  const sw = Math.min(side, media.width - sx);
  const sh = Math.min(side, media.height - sy);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");

  ctx.drawImage(input as CanvasImageSource, sx, sy, sw, sh, 0, 0, size, size);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao comprimir a foto."))),
      "image/jpeg",
      quality,
    );
  });
}

export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
