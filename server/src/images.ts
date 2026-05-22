import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import { cachePathsForRel } from "./metadata.js";

export const MIN_CACHED_WEBP_BYTES = 128;

const MAX_CONCURRENT_DERIV = Math.max(
  1,
  Number(process.env.DERIVATIVE_CONCURRENCY ?? 3) || 3,
);
let derivActive = 0;
const derivWaiters: Array<() => void> = [];

async function withDerivLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (derivActive >= MAX_CONCURRENT_DERIV) {
    await new Promise<void>((resolve) => derivWaiters.push(resolve));
  }
  derivActive++;
  try {
    return await fn();
  } finally {
    derivActive--;
    derivWaiters.shift()?.();
  }
}

export async function isValidCacheFile(cachePath: string): Promise<boolean> {
  try {
    const st = await fs.stat(cachePath);
    return st.isFile() && st.size >= MIN_CACHED_WEBP_BYTES;
  } catch {
    return false;
  }
}

async function writeWebpAtomic(
  buf: Buffer,
  outPath: string,
  resizeWidth: number,
  quality: number,
): Promise<boolean> {
  const tmp = `${outPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await sharp(buf)
      .rotate()
      .resize({ width: resizeWidth, withoutEnlargement: true })
      .webp({ quality })
      .toFile(tmp);
    const st = await fs.stat(tmp);
    if (st.size < MIN_CACHED_WEBP_BYTES) {
      await fs.unlink(tmp);
      return false;
    }
    await fs.rename(tmp, outPath);
    return true;
  } catch {
    try {
      await fs.unlink(tmp);
    } catch {
      /* */
    }
    return false;
  }
}

export type EnsureDerivativesOptions = { /** Rebuild even when valid cache exists (after explicit invalidation). */ force?: boolean };

export async function ensureDerivatives(
  absImagePath: string,
  relPath: string,
  cacheKeySuffix = "",
  opts?: EnsureDerivativesOptions,
) {
  return withDerivLimit(() => ensureDerivativesInner(absImagePath, relPath, cacheKeySuffix, opts));
}

async function ensureDerivativesInner(
  absImagePath: string,
  relPath: string,
  cacheKeySuffix = "",
  opts?: EnsureDerivativesOptions,
) {
  await fs.mkdir(path.join(config.cacheDir, "thumbs"), { recursive: true });
  await fs.mkdir(path.join(config.cacheDir, "web"), { recursive: true });

  const { thumb, web } = cachePathsForRel(relPath, cacheKeySuffix);
  const thumbOk = await isValidCacheFile(thumb);
  const webOk = await isValidCacheFile(web);

  /** Keep existing WebP unless missing/invalid. Copy/move changes source mtime but not pixels. */
  if (!opts?.force && thumbOk && webOk) {
    return { width: null, height: null, thumbExists: true, webExists: true, thumb, web };
  }

  let srcStat;
  try {
    srcStat = await fs.stat(absImagePath);
  } catch {
    return {
      width: null,
      height: null,
      thumbExists: thumbOk,
      webExists: webOk,
      thumb,
      web,
    };
  }

  const force = opts?.force === true;
  const needThumb = !thumbOk || force;
  const needWeb = !webOk || force;

  if (!needThumb && !needWeb) {
    return { width: null, height: null, thumbExists: true, webExists: true, thumb, web };
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(absImagePath);
  } catch {
    return { width: null, height: null, thumbExists: thumbOk, webExists: webOk, thumb, web };
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    return { width: null, height: null, thumbExists: thumbOk, webExists: webOk, thumb, web };
  }

  const width = meta.width ?? null;
  const height = meta.height ?? null;

  let thumbExists = thumbOk;
  let webExists = webOk;

  if (needThumb) {
    thumbExists = (await writeWebpAtomic(buf, thumb, 320, 78)) || thumbOk;
  }

  if (needWeb) {
    webExists = (await writeWebpAtomic(buf, web, 1920, 85)) || webOk;
  }

  return { width, height, thumbExists, webExists, thumb, web };
}
