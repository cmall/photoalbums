import path from "node:path";
import { exiftool } from "exiftool-vendored";
import { config } from "./config.js";
import type { PhotoMetadata } from "./metadata.js";
import { parseStoredPhotoDate } from "./photo-date.js";

const EXIF_WRITABLE_EXT = new Set([".jpg", ".jpeg", ".tif", ".tiff", ".png"]);

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function exifDateTime(y: number, m: number, d: number) {
  return `${y}:${pad2(m)}:${pad2(d)} 00:00:00`;
}

/** Map app metadata to ExifTool tag names (EXIF / IPTC / XMP). */
export function metadataToExifTags(meta: PhotoMetadata): Record<string, string | null> {
  const tags: Record<string, string | null> = {};

  const desc = meta.description?.trim();
  tags.ImageDescription = desc || null;
  tags.CaptionAbstract = desc || null;
  tags.Description = desc || null;

  const loc = meta.location?.trim();
  tags.Location = loc || null;
  tags.City = loc || null;

  const stored = meta.date?.trim();
  if (!stored) {
    tags.DateTimeOriginal = null;
    tags.CreateDate = null;
    tags.DateCreated = null;
    tags.Label = null;
    return tags;
  }

  const p = parseStoredPhotoDate(stored);
  if (!p) {
    tags.Label = stored;
    return tags;
  }

  let y: number;
  let m = 1;
  let d = 1;
  switch (p.kind) {
    case "exact":
      y = p.year;
      m = p.month;
      d = p.day;
      break;
    case "month":
      y = p.year;
      m = p.month;
      break;
    case "year":
    case "circa":
    case "range":
      y = p.year;
      break;
  }

  const dt = exifDateTime(y, m, d);
  tags.DateTimeOriginal = dt;
  tags.CreateDate = dt;
  tags.DateCreated = `${y}:${pad2(m)}:${pad2(d)}`;
  tags.Label = p.kind === "exact" ? null : stored;
  return tags;
}

export async function writePhotoMetadataToExif(
  imageAbs: string,
  meta: PhotoMetadata,
): Promise<void> {
  if (!config.writeMetadataToExif) return;

  const ext = path.extname(imageAbs).toLowerCase();
  if (!EXIF_WRITABLE_EXT.has(ext)) return;

  const tags = metadataToExifTags(meta);
  await exiftool.write(imageAbs, tags, {
    writeArgs: ["-overwrite_original"],
  });
}

export async function shutdownExifTool() {
  await exiftool.end();
}
