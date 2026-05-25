import * as blazeface from "@tensorflow-models/blazeface";
import * as tf from "@tensorflow/tfjs";
import sharp from "sharp";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { displaySourceAbsFromPrimaryRel } from "./metadata.js";
import { resolveOrBuildDerivative } from "./media-serve.js";

export type FaceSuggestion = {
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  confidence: number;
};

const MAX_EDGE = 640;
const MIN_CONFIDENCE = 0.55;
const MIN_BOX = 0.04;
const TAG_NEAR = 0.07;

let modelPromise: ReturnType<typeof blazeface.load> | null = null;
let backendPromise: Promise<void> | null = null;

function ensureBackend() {
  if (!backendPromise) {
    backendPromise = (async () => {
      await tf.setBackend("cpu");
      await tf.ready();
    })();
  }
  return backendPromise;
}

function loadModel() {
  if (!modelPromise) {
    modelPromise = ensureBackend().then(() => blazeface.load());
  }
  return modelPromise;
}

function overlapsExistingTag(
  normX: number,
  normY: number,
  existing: { norm_x: number; norm_y: number }[],
): boolean {
  for (const t of existing) {
    const dx = normX - t.norm_x;
    const dy = normY - t.norm_y;
    if (dx * dx + dy * dy < TAG_NEAR * TAG_NEAR) return true;
  }
  return false;
}

/** Run BlazeFace on the enhanced/web preview for a primary photo rel path. */
export async function detectFaceSuggestions(primaryRel: string): Promise<FaceSuggestion[]> {
  if (!config.faceDetectionEnabled) return [];

  const webPath = await resolveOrBuildDerivative(primaryRel, "web");
  const sourceAbs = displaySourceAbsFromPrimaryRel(primaryRel);
  if (!webPath && !sourceAbs) return [];

  let inputPath = webPath;
  if (!inputPath && sourceAbs) {
    inputPath = sourceAbs;
  }
  if (!inputPath) return [];

  const { data, info } = await sharp(inputPath)
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (w <= 0 || h <= 0) return [];

  const model = await loadModel();
  const tensor = tf.tensor3d(new Uint8Array(data), [h, w, 3]);
  let faces: Awaited<ReturnType<typeof model.estimateFaces>>;
  try {
    faces = await model.estimateFaces(tensor, false);
  } finally {
    tensor.dispose();
  }

  const db = getDb();
  const asset = db.prepare("SELECT id FROM assets WHERE rel_path = ?").get(primaryRel) as
    | { id: string }
    | undefined;
  const existing = asset
    ? (db
        .prepare("SELECT norm_x, norm_y FROM person_tags WHERE asset_id = ?")
        .all(asset.id) as { norm_x: number; norm_y: number }[])
    : [];

  const out: FaceSuggestion[] = [];
  for (const face of faces) {
    const topLeft = face.topLeft as [number, number];
    const bottomRight = face.bottomRight as [number, number];
    const x1 = Math.max(0, Math.min(w, topLeft[0]));
    const y1 = Math.max(0, Math.min(h, topLeft[1]));
    const x2 = Math.max(0, Math.min(w, bottomRight[0]));
    const y2 = Math.max(0, Math.min(h, bottomRight[1]));
    const boxW = (x2 - x1) / w;
    const boxH = (y2 - y1) / h;
    if (boxW < MIN_BOX || boxH < MIN_BOX) continue;

    const normX = (x1 + x2) / 2 / w;
    const normY = (y1 + y2) / 2 / h;
    const confidence = typeof face.probability === "number" ? face.probability : 0.9;
    if (confidence < MIN_CONFIDENCE) continue;
    if (overlapsExistingTag(normX, normY, existing)) continue;

    out.push({
      normX: round(normX),
      normY: round(normY),
      normW: round(boxW),
      normH: round(boxH),
      confidence: round(confidence),
    });
  }

  out.sort((a, b) => a.normY - b.normY || a.normX - b.normX);
  return out;
}

function round(n: number) {
  return Math.round(n * 10000) / 10000;
}
