import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import { cachePathsForRel } from "./metadata.js";

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

async function cacheIsFresh(cachePath: string, sourceMtimeMs: number): Promise<boolean> {
  try {
    const c = await fs.stat(cachePath);
    return c.mtimeMs >= sourceMtimeMs;
  } catch {
    return false;
  }
}

export async function ensureDerivatives(
  absImagePath: string,
  relPath: string,
  cacheKeySuffix = "",
) {
  return withDerivLimit(() => ensureDerivativesInner(absImagePath, relPath, cacheKeySuffix));
}

async function ensureDerivativesInner(
  absImagePath: string,
  relPath: string,
  cacheKeySuffix = "",
) {
  await fs.mkdir(path.join(config.cacheDir, "thumbs"), { recursive: true });
  await fs.mkdir(path.join(config.cacheDir, "web"), { recursive: true });

  const { thumb, web } = cachePathsForRel(relPath, cacheKeySuffix);

  let srcStat;
  try {
    srcStat = await fs.stat(absImagePath);
  } catch {
    return { width: null, height: null, thumbExists: false, webExists: false, thumb, web };
  }
  const srcMtime = srcStat.mtimeMs;

  const thumbFresh = await cacheIsFresh(thumb, srcMtime);
  const webFresh = await cacheIsFresh(web, srcMtime);

  if (thumbFresh && webFresh) {
    try {
      const meta = await sharp(absImagePath).metadata();
      return {
        width: meta.width ?? null,
        height: meta.height ?? null,
        thumbExists: true,
        webExists: true,
        thumb,
        web,
      };
    } catch {
      return { width: null, height: null, thumbExists: true, webExists: true, thumb, web };
    }
  }

  const buf = await fs.readFile(absImagePath);
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    return { width: null, height: null, thumbExists: false, webExists: false, thumb, web };
  }

  const width = meta.width ?? null;
  const height = meta.height ?? null;

  let thumbExists = thumbFresh;
  let webExists = webFresh;

  if (!thumbFresh) {
    try {
      await sharp(buf)
        .rotate()
        .resize({ width: 320, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(thumb);
      thumbExists = true;
    } catch {
      /* ignore */
    }
  }

  if (!webFresh) {
    try {
      await sharp(buf)
        .rotate()
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(web);
      webExists = true;
    } catch {
      /* ignore */
    }
  }

  return { width, height, thumbExists, webExists, thumb, web };
}
