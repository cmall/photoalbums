import fsSync from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { ensureDerivatives } from "./images.js";
import {
  backAbsFromPrimaryRel,
  cachePathsForRel,
  displaySourceAbsFromPrimaryRel,
} from "./metadata.js";

export function thumbOnDemandEnabled() {
  return (
    process.env.ENABLE_ON_DEMAND_THUMBNAILS === "1" ||
    process.env.ENABLE_ON_DEMAND_THUMBNAILS === "true"
  );
}

function tryExisting(abs: string): string | null {
  return fsSync.existsSync(abs) ? abs : null;
}

/** Resolve a cached WebP derivative on local disk — never touches the photo library volume. */
export function resolveCachedDerivativePath(
  primaryRel: string,
  variant: "thumb" | "web",
  suffix = "",
): string | null {
  if (!suffix) {
    const row = getDb()
      .prepare("SELECT thumb_rel, web_rel FROM assets WHERE rel_path = ?")
      .get(primaryRel) as { thumb_rel: string | null; web_rel: string | null } | undefined;
    if (row) {
      const rel = variant === "thumb" ? row.thumb_rel : row.web_rel;
      if (rel) {
        const hit = tryExisting(path.join(config.cacheDir, rel));
        if (hit) return hit;
      }
    }
  }

  const { thumb, web } = cachePathsForRel(primaryRel, suffix);
  return tryExisting(variant === "thumb" ? thumb : web);
}

/** Serve cached file or optionally build derivative on demand (local dev only by default). */
export async function resolveOrBuildDerivative(
  primaryRel: string,
  variant: "thumb" | "web",
  suffix = "",
): Promise<string | null> {
  const cached = resolveCachedDerivativePath(primaryRel, variant, suffix);
  if (cached) return cached;
  if (!thumbOnDemandEnabled()) return null;

  if (suffix === "__back") {
    const backAbs = backAbsFromPrimaryRel(primaryRel);
    if (!backAbs) return null;
    await ensureDerivatives(backAbs, primaryRel, suffix);
  } else {
    const displayAbs = displaySourceAbsFromPrimaryRel(primaryRel);
    if (!displayAbs) return null;
    await ensureDerivatives(displayAbs, primaryRel);
  }
  return resolveCachedDerivativePath(primaryRel, variant, suffix);
}
