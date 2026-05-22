import fsSync from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { ensureDerivatives, MIN_CACHED_WEBP_BYTES } from "./images.js";
import {
  backAbsFromPrimaryRel,
  cachePathsForRel,
  displaySourceAbsFromPrimaryRel,
} from "./metadata.js";

/** On-demand WebP builds when cache is missing. Set ENABLE_ON_DEMAND_THUMBNAILS=0 to disable. */
export function thumbOnDemandEnabled() {
  const v = process.env.ENABLE_ON_DEMAND_THUMBNAILS;
  if (v === "0" || v === "false") return false;
  return true;
}

const MIN_CACHED_WEBP_BYTES_EXPORT = MIN_CACHED_WEBP_BYTES;

function tryExisting(abs: string): string | null {
  try {
    const st = fsSync.statSync(abs);
    if (st.isFile() && st.size >= MIN_CACHED_WEBP_BYTES_EXPORT) return abs;
  } catch {
    /* missing */
  }
  return null;
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

const inflightBuilds = new Map<string, Promise<string | null>>();

async function buildDerivative(
  primaryRel: string,
  variant: "thumb" | "web",
  suffix: string,
): Promise<string | null> {
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

/** Serve cached WebP or build from the photo library when the source file exists. */
export async function resolveOrBuildDerivative(
  primaryRel: string,
  variant: "thumb" | "web",
  suffix = "",
): Promise<string | null> {
  const cached = resolveCachedDerivativePath(primaryRel, variant, suffix);
  if (cached) return cached;
  if (!thumbOnDemandEnabled()) return cached;

  const key = `${primaryRel}\0${variant}\0${suffix}`;
  let pending = inflightBuilds.get(key);
  if (!pending) {
    pending = buildDerivative(primaryRel, variant, suffix).finally(() => {
      inflightBuilds.delete(key);
    });
    inflightBuilds.set(key, pending);
  }
  const built = await pending;
  if (built) return built;
  /** Build failed — serve any existing cache rather than 404 (e.g. source briefly unavailable). */
  return resolveCachedDerivativePath(primaryRel, variant, suffix);
}
