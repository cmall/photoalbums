import path from "node:path";
import { isImageExt } from "./paths.js";

/** Scan suffix: `_a` = enhanced scan (used for thumbs/web), `_b` = back, none = original. */
export function classifyStem(stem: string): { base: string; kind: "primary" | "a" | "b" } {
  if (stem.length > 2 && stem.endsWith("_a")) {
    return { base: stem.slice(0, -2), kind: "a" };
  }
  if (stem.length > 2 && stem.endsWith("_b")) {
    return { base: stem.slice(0, -2), kind: "b" };
  }
  return { base: stem, kind: "primary" };
}

export type GroupedPrimary = {
  /** Original file (no _a/_b); metadata + tags + `rel` identity */
  relPath: string;
  filename: string;
  folder: string | null;
  /** File used for thumbnail/web derivatives (usually `*_a`, else original) */
  thumbSourceRel: string;
  backRelPath: string | null;
};

type Slot = { primary?: string; a?: string; b?: string };

function posixRel(p: string) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Group directory image files into primaries. Only entries with a primary (non-suffix) file are returned.
 * `_a` / `_b` are not listed as separate items.
 */
export function groupFolderImages(filenames: string[], folderName: string | null): GroupedPrimary[] {
  const prefix = folderName ? `${folderName}/` : "";
  const map = new Map<string, Slot>();

  for (const name of filenames) {
    const ext = path.extname(name);
    if (!isImageExt(ext)) continue;
    const stem = path.basename(name, ext);
    const { base, kind } = classifyStem(stem);
    if (!map.has(base)) map.set(base, {});
    const slot = map.get(base)!;
    if (kind === "primary") slot.primary = name;
    else if (kind === "a") slot.a = name;
    else slot.b = name;
  }

  const out: GroupedPrimary[] = [];
  for (const slot of map.values()) {
    if (!slot.primary) continue;
    const relPath = posixRel(`${prefix}${slot.primary}`);
    const thumbSourceRel = slot.a ? posixRel(`${prefix}${slot.a}`) : relPath;
    const backRelPath = slot.b ? posixRel(`${prefix}${slot.b}`) : null;
    out.push({
      relPath,
      filename: slot.primary,
      folder: folderName,
      thumbSourceRel,
      backRelPath,
    });
  }

  out.sort((x, y) => x.filename.localeCompare(y.filename));
  return out;
}
