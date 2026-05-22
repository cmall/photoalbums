import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { resolveSafeUnderRoot, toRelFromRoot } from "./paths.js";

import { getDb } from "./db.js";

const trimEmpty = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);

const MetadataSchema = z.object({
  date: trimEmpty,
  location: trimEmpty,
  description: trimEmpty,
});

export type PhotoMetadata = z.infer<typeof MetadataSchema>;

export type AssetMetaDbRow = {
  event_date: string | null;
  location: string | null;
  description: string | null;
};

function trimToNull(s: string | undefined) {
  if (s == null) return null;
  const t = String(s).trim();
  return t === "" ? null : t;
}

/** Normalize photo JSON fields for SQLite columns on `assets`. */
export function photoMetadataToDbColumns(meta: PhotoMetadata): AssetMetaDbRow {
  return {
    event_date: trimToNull(meta.date),
    location: trimToNull(meta.location),
    description: trimToNull(meta.description),
  };
}

/** Build API/metadata shape from DB row (same keys as JSON file). */
export function photoMetadataFromDbRow(r: AssetMetaDbRow): PhotoMetadata {
  const m: PhotoMetadata = {};
  if (r.event_date != null && r.event_date !== "") m.date = r.event_date;
  if (r.location != null && r.location !== "") m.location = r.location;
  if (r.description != null && r.description !== "") m.description = r.description;
  return m;
}

export function updateAssetMetadataInDb(relPath: string, meta: PhotoMetadata) {
  const cols = photoMetadataToDbColumns(meta);
  getDb()
    .prepare(
      `UPDATE assets SET event_date = @event_date, location = @location,
       description = @description, caption = NULL WHERE rel_path = @rel`,
    )
    .run({ ...cols, rel: relPath });
}

function sidecarPathForImageAbs(imageAbs: string) {
  const dir = path.dirname(imageAbs);
  const base = path.basename(imageAbs, path.extname(imageAbs));
  return path.join(dir, `${base}.json`);
}

export async function readSidecarJson(imageAbs: string): Promise<PhotoMetadata> {
  const sc = sidecarPathForImageAbs(imageAbs);
  try {
    const raw = await fs.readFile(sc, "utf8");
    const parsed = JSON.parse(raw);
    const r = MetadataSchema.safeParse(parsed);
    return r.success ? r.data : {};
  } catch {
    return {};
  }
}

export async function writeSidecarJson(imageAbs: string, data: PhotoMetadata) {
  const sc = sidecarPathForImageAbs(imageAbs);
  const merged = { ...(await readSidecarJson(imageAbs)), ...data };
  const cleaned = MetadataSchema.parse(merged);
  await fs.writeFile(sc, JSON.stringify(cleaned, null, 2), "utf8");
  const imageRel = toRelFromRoot(imageAbs);
  updateAssetMetadataInDb(imageRel, cleaned);
  return toRelFromRoot(sc);
}

export function imageAbsFromRel(rel: string): string | null {
  const abs = resolveSafeUnderRoot(rel);
  if (!abs) return null;
  return abs;
}

/** Pixel source for thumbnails / web: `stem_a.ext` next to primary if present, else primary file. */
export function displaySourceAbsFromPrimaryRel(primaryRel: string): string | null {
  const primaryAbs = imageAbsFromRel(primaryRel);
  if (!primaryAbs) return null;
  const dir = path.dirname(primaryAbs);
  const ext = path.extname(primaryAbs);
  const stem = path.basename(primaryAbs, ext);
  const aAbs = path.join(dir, `${stem}_a${ext}`);
  if (fsSync.existsSync(aAbs)) return aAbs;
  return primaryAbs;
}

/** Back-of-print scan `stem_b.ext` next to primary, if present. */
export function backAbsFromPrimaryRel(primaryRel: string): string | null {
  const primaryAbs = imageAbsFromRel(primaryRel);
  if (!primaryAbs) return null;
  const dir = path.dirname(primaryAbs);
  const ext = path.extname(primaryAbs);
  const stem = path.basename(primaryAbs, ext);
  const bAbs = path.join(dir, `${stem}_b${ext}`);
  if (fsSync.existsSync(bAbs)) return bAbs;
  return null;
}

export async function statMtimeMs(p: string) {
  try {
    const st = await fs.stat(p);
    return st.mtimeMs;
  } catch {
    return null;
  }
}

/** Optional suffix (e.g. `__back`) so alternate derivatives do not clobber the main cache key. */
export function cachePathsForRel(relPath: string, keySuffix = "") {
  const safeKey = relPath.replace(/\//g, "__") + keySuffix;
  const thumb = path.join(config.cacheDir, "thumbs", `${safeKey}.webp`);
  const web = path.join(config.cacheDir, "web", `${safeKey}.webp`);
  return { thumb, web, safeKey };
}
