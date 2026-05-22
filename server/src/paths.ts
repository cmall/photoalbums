import path from "node:path";
import { config } from "./config.js";

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".tif",
  ".tiff",
  ".bmp",
]);

export function isImageExt(ext: string) {
  return IMAGE_EXT.has(ext.toLowerCase());
}

/** Normalize relative path: posix-style, no leading ./ */
export function normalizeRel(p: string) {
  let x = p.replace(/\\/g, "/").trim();
  while (x.startsWith("./")) x = x.slice(2);
  if (x.startsWith("/")) x = x.slice(1);
  return x;
}

/**
 * Resolve user-supplied relative path under photo root.
 * Enforces: no traversal, single folder depth only.
 * Returns absolute path or null if invalid.
 */
export function resolveSafeUnderRoot(relRaw: string): string | null {
  const rel = normalizeRel(relRaw);
  if (rel.includes("..")) return null;
  const abs = path.resolve(config.photoRoot, rel);
  const root = path.resolve(config.photoRoot);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;

  const segments = rel.split("/").filter(Boolean);
  if (segments.length > 2) return null;

  return abs;
}

/** Relative path from photo root, posix */
export function toRelFromRoot(absPath: string) {
  const rel = path.relative(config.photoRoot, absPath);
  return rel.split(path.sep).join("/");
}

export function isUnderSingleLevel(rel: string): boolean {
  const segs = normalizeRel(rel).split("/").filter(Boolean);
  return segs.length <= 2;
}
