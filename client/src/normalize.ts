import type { LibraryFolder, LibraryPhoto } from "./api";

/** API summary rows may omit tags/metadata; ensure render-safe LibraryPhoto objects. */
export function normalizeLibraryPhoto(
  p: Partial<LibraryPhoto> & Pick<LibraryPhoto, "relPath">,
): LibraryPhoto {
  const filename = p.filename ?? p.relPath.split("/").pop() ?? p.relPath;
  return {
    relPath: p.relPath,
    filename,
    folder: p.folder ?? null,
    thumbSourceRel: p.thumbSourceRel ?? p.relPath,
    backRelPath: p.backRelPath ?? null,
    metadata: p.metadata ?? {},
    tags: p.tags ?? [],
  };
}

export function normalizeFolderFromSummary(
  f: Omit<LibraryFolder, "photos" | "photosLoaded">,
): LibraryFolder {
  const previewPhotos = (f.previewPhotos ?? []).map((p) => normalizeLibraryPhoto(p));
  return {
    name: f.name,
    defaultYear: f.defaultYear ?? null,
    needsImport: f.needsImport ?? false,
    diskPhotoCount: f.diskPhotoCount,
    photoCount: f.photoCount ?? previewPhotos.length,
    previewPhotos,
    photos: previewPhotos,
    photosLoaded: false,
  };
}
