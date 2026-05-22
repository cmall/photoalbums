import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import type { ImportJobRow } from "./db.js";
import { getDb } from "./db.js";
import { ensureDerivatives } from "./images.js";
import { backAbsFromPrimaryRel, cachePathsForRel, readSidecarJson, statMtimeMs, photoMetadataToDbColumns } from "./metadata.js";
import { groupFolderImages, type GroupedPrimary } from "./photo-groups.js";
import { isImageExt, normalizeRel, resolveSafeUnderRoot, toRelFromRoot } from "./paths.js";
import { assetRowToGroupedPrimary } from "./asset-catalog.js";

function sidecarAbs(imageAbs: string) {
  const dir = path.dirname(imageAbs);
  const base = path.basename(imageAbs, path.extname(imageAbs));
  return path.join(dir, `${base}.json`);
}

function folderFromRelPath(rel: string): string | null {
  const segs = normalizeRel(rel).split("/").filter(Boolean);
  if (segs.length <= 1) return null;
  return segs[0] ?? null;
}

async function listRootEntries() {
  return fs.readdir(config.photoRoot, { withFileTypes: true });
}

export type LibraryPhoto = GroupedPrimary;

export type LibraryFolder = {
  name: string;
  photos: LibraryPhoto[];
  /** When true, photos are not synced until user runs import (new folder on disk). */
  needsImport: boolean;
  /** Count of primary photo groups on disk (for UX before import). */
  diskPhotoCount?: number;
};

function getImportedFolderNames(): Set<string> {
  const db = getDb();
  const rows = db.prepare("SELECT folder_name FROM imported_folders").all() as { folder_name: string }[];
  return new Set(rows.map((r) => r.folder_name));
}

function dbRowToPreviewPhoto(row: {
  rel_path: string;
  filename: string;
  folder_name: string | null;
  thumb_source_rel?: string | null;
  back_rel_path?: string | null;
}): GroupedPrimary {
  return assetRowToGroupedPrimary({
    rel_path: row.rel_path,
    filename: row.filename,
    folder_name: row.folder_name,
    thumb_source_rel: row.thumb_source_rel ?? row.rel_path,
    back_rel_path: row.back_rel_path ?? null,
  });
}

export type LibraryFolderSummary = {
  name: string;
  photoCount: number;
  previewPhotos: GroupedPrimary[];
  needsImport: boolean;
  diskPhotoCount?: number;
};

/** Fast catalog overview from SQLite only (no photo-root disk access). */
export function getLibrarySummary(): {
  rootPhotoCount: number;
  rootPreviewPhotos: GroupedPrimary[];
  folders: LibraryFolderSummary[];
} {
  const db = getDb();
  const imported = getImportedFolderNames();

  const rootCount = db.prepare(`SELECT COUNT(*) as n FROM assets WHERE folder_name IS NULL`).get() as {
    n: number;
  };
  const rootPreviews = db
    .prepare(
      `SELECT rel_path, filename, folder_name, thumb_source_rel, back_rel_path FROM assets
       WHERE folder_name IS NULL ORDER BY filename LIMIT 4`,
    )
    .all() as {
    rel_path: string;
    filename: string;
    folder_name: string | null;
    thumb_source_rel: string | null;
    back_rel_path: string | null;
  }[];

  const folderCounts = db
    .prepare(
      `SELECT folder_name, COUNT(*) as photo_count FROM assets
       WHERE folder_name IS NOT NULL GROUP BY folder_name`,
    )
    .all() as { folder_name: string; photo_count: number }[];

  const previewRows = db
    .prepare(
      `WITH ranked AS (
         SELECT rel_path, filename, folder_name, thumb_source_rel, back_rel_path,
                ROW_NUMBER() OVER (PARTITION BY folder_name ORDER BY filename) AS rn
         FROM assets WHERE folder_name IS NOT NULL
       )
       SELECT rel_path, filename, folder_name, thumb_source_rel, back_rel_path FROM ranked WHERE rn <= 4`,
    )
    .all() as {
    rel_path: string;
    filename: string;
    folder_name: string | null;
    thumb_source_rel: string | null;
    back_rel_path: string | null;
  }[];

  const previewsByFolder = new Map<string, GroupedPrimary[]>();
  for (const row of previewRows) {
    if (!row.folder_name) continue;
    const arr = previewsByFolder.get(row.folder_name) ?? [];
    arr.push(dbRowToPreviewPhoto(row));
    previewsByFolder.set(row.folder_name, arr);
  }

  const folders: LibraryFolderSummary[] = [];
  const counted = new Set<string>();

  for (const row of folderCounts) {
    counted.add(row.folder_name);
    folders.push({
      name: row.folder_name,
      photoCount: row.photo_count,
      previewPhotos: previewsByFolder.get(row.folder_name) ?? [],
      needsImport: !imported.has(row.folder_name),
    });
  }

  for (const name of imported) {
    if (counted.has(name)) continue;
    folders.push({
      name,
      photoCount: 0,
      previewPhotos: [],
      needsImport: false,
    });
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));

  return {
    rootPhotoCount: rootCount.n,
    rootPreviewPhotos: rootPreviews.map(dbRowToPreviewPhoto),
    folders,
  };
}

/** Scan disk for folders not yet imported (slow on network volumes — call separately). */
export async function getUnimportedFoldersOnDisk(): Promise<LibraryFolderSummary[]> {
  await fs.mkdir(config.photoRoot, { recursive: true });
  const imported = getImportedFolderNames();
  const entries = await listRootEntries();
  const unimported = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith(".") && !imported.has(e.name),
  );
  const results = await Promise.all(
    unimported.map(async (ent): Promise<LibraryFolderSummary | null> => {
      const dirAbs = path.join(config.photoRoot, ent.name);
      try {
        const sub = await fs.readdir(dirAbs, { withFileTypes: true });
        const fileNames = sub.filter((f) => f.isFile()).map((f) => f.name);
        return {
          name: ent.name,
          photoCount: 0,
          previewPhotos: [],
          needsImport: true,
          diskPhotoCount: groupFolderImages(fileNames, ent.name).length,
        };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((f): f is LibraryFolderSummary => f != null).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getFolderPhotos(folderName: string): Promise<GroupedPrimary[]> {
  if (!getImportedFolderNames().has(folderName)) return [];
  const dirAbs = path.join(config.photoRoot, folderName);
  const names = await fs.readdir(dirAbs);
  const photos = groupFolderImages(names, folderName);
  photos.sort((a, b) => a.filename.localeCompare(b.filename));
  return photos;
}

export async function getRootPhotosFromDisk(): Promise<GroupedPrimary[]> {
  const entries = await listRootEntries();
  const rootNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  const photos = groupFolderImages(rootNames, null);
  photos.sort((a, b) => a.filename.localeCompare(b.filename));
  return photos;
}

export async function getLibrary(): Promise<{
  rootPhotos: LibraryPhoto[];
  folders: LibraryFolder[];
}> {
  await fs.mkdir(config.photoRoot, { recursive: true });
  getDb();
  const imported = getImportedFolderNames();
  const entries = await listRootEntries();
  const rootFileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  const rootPhotos = groupFolderImages(rootFileNames, null);
  const dirEntries = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const folderResults = await Promise.all(
    dirEntries.map(async (ent): Promise<LibraryFolder | null> => {
      const dirName = ent.name;
      const dirAbs = path.join(config.photoRoot, dirName);
      try {
        const sub = await fs.readdir(dirAbs, { withFileTypes: true });
        const fileNames = sub.filter((f) => f.isFile()).map((f) => f.name);
        if (!imported.has(dirName)) {
          return {
            name: dirName,
            photos: [],
            needsImport: true,
            diskPhotoCount: groupFolderImages(fileNames, dirName).length,
          };
        }
        return {
          name: dirName,
          photos: groupFolderImages(fileNames, dirName),
          needsImport: false,
        };
      } catch {
        return null;
      }
    }),
  );
  const folders = folderResults.filter((f): f is LibraryFolder => f != null);

  rootPhotos.sort((a, b) => a.filename.localeCompare(b.filename));
  folders.sort((a, b) => a.name.localeCompare(b.name));
  return { rootPhotos, folders };
}

/** All primary rows that should exist after sync (root + imported subfolders). */
export async function collectPrimariesToSync(): Promise<GroupedPrimary[]> {
  const imported = getImportedFolderNames();
  const entries = await listRootEntries();
  const out: GroupedPrimary[] = [];
  const rootNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  out.push(...groupFolderImages(rootNames, null));
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    if (!imported.has(ent.name)) continue;
    const dirAbs = path.join(config.photoRoot, ent.name);
    let names: string[];
    try {
      names = await fs.readdir(dirAbs);
    } catch {
      continue;
    }
    out.push(...groupFolderImages(names, ent.name));
  }
  return out;
}

export async function syncOneAsset(p: GroupedPrimary) {
  const db = getDb();
  const absPrimary = resolveSafeUnderRoot(p.relPath);
  const absDisplay = resolveSafeUnderRoot(p.thumbSourceRel);
  if (!absPrimary || !absDisplay) return;
  const ext = path.extname(p.filename);
  const folderName = p.folder;
  const { width, height } = await ensureDerivatives(absDisplay, p.relPath);
  const { thumb, web } = cachePathsForRel(p.relPath);
  const relThumb = path.relative(config.cacheDir, thumb);
  const relWeb = path.relative(config.cacheDir, web);

  const existing = db.prepare("SELECT id FROM assets WHERE rel_path = ?").get(p.relPath) as
    | { id: string }
    | undefined;
  const jsonM = await statMtimeMs(sidecarAbs(absPrimary));
  const sidecarMeta = await readSidecarJson(absPrimary);
  const dbMeta = photoMetadataToDbColumns(sidecarMeta);

  if (existing) {
    db.prepare(
      `UPDATE assets SET folder_name = ?, filename = ?, ext = ?, thumb_rel = ?, web_rel = ?,
       thumb_source_rel = ?, back_rel_path = ?,
       width = ?, height = ?, json_mtime = ?, event_date = ?, location = ?, description = ?, caption = NULL,
       scanned_at = datetime('now')
       WHERE id = ?`,
    ).run(
      folderName,
      p.filename,
      ext,
      relThumb,
      relWeb,
      p.thumbSourceRel,
      p.backRelPath,
      width,
      height,
      jsonM,
      dbMeta.event_date,
      dbMeta.location,
      dbMeta.description,
      existing.id,
    );
  } else {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO assets (id, rel_path, folder_name, filename, ext, thumb_rel, web_rel,
       thumb_source_rel, back_rel_path, width, height, json_mtime, event_date, location, description, caption)
       VALUES (@id, @rel_path, @folder_name, @filename, @ext, @thumb_rel, @web_rel,
       @thumb_source_rel, @back_rel_path, @width, @height, @json_mtime, @event_date, @location, @description, NULL)`,
    ).run({
      id,
      rel_path: p.relPath,
      folder_name: folderName,
      filename: p.filename,
      ext,
      thumb_rel: relThumb,
      web_rel: relWeb,
      thumb_source_rel: p.thumbSourceRel,
      back_rel_path: p.backRelPath,
      width,
      height,
      json_mtime: jsonM,
      event_date: dbMeta.event_date,
      location: dbMeta.location,
      description: dbMeta.description,
    });
  }
}

export type SyncStatus = {
  running: boolean;
  done: number;
  total: number;
};

let syncStatus: SyncStatus = { running: false, done: 0, total: 0 };
let syncPromise: Promise<void> | null = null;

export function getSyncStatus(): SyncStatus {
  return { ...syncStatus };
}

/** Sync DB assets from disk + thumbnails for root and imported folders only. */
export function syncAssetsFromDisk(): Promise<void> {
  if (syncPromise) return syncPromise;
  syncPromise = runSyncAssetsFromDisk().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

async function runSyncAssetsFromDisk() {
  const db = getDb();
  const all = await collectPrimariesToSync();
  syncStatus = { running: true, done: 0, total: all.length };
  const seen = new Set<string>();

  try {
    for (let i = 0; i < all.length; i++) {
      const p = all[i]!;
      seen.add(p.relPath);
      await syncOneAsset(p);
      syncStatus.done = i + 1;
      if (i % 5 === 4) await new Promise<void>((r) => setImmediate(r));
    }

    const rows = db.prepare("SELECT id, rel_path FROM assets").all() as {
      id: string;
      rel_path: string;
    }[];
    for (const r of rows) {
      if (!seen.has(r.rel_path)) {
        db.prepare("DELETE FROM person_tags WHERE asset_id = ?").run(r.id);
        db.prepare("DELETE FROM assets WHERE id = ?").run(r.id);
      }
    }
  } finally {
    syncStatus = { running: false, done: syncStatus.done, total: syncStatus.total };
  }
}

const BAD_NAME = /[<>:"/\\|?*\x00-\x1f]/;

export function assertValidFolderName(name: string) {
  const t = name.trim();
  if (!t || t.includes("/") || t.includes("\\") || t === "." || t === "..")
    throw new Error("Invalid folder name");
  if (BAD_NAME.test(t)) throw new Error("Folder name contains invalid characters");
  return t;
}

/** Prefix for `AlbumStem_001.jpg`: spaces (and any run of whitespace) → single `_`. */
function folderStemForRenumberedFiles(folderDisplayName: string): string {
  return folderDisplayName.trim().split(/\s+/).filter(Boolean).join("_");
}

export async function createFolder(name: string) {
  const n = assertValidFolderName(name);
  const abs = path.join(config.photoRoot, n);
  await fs.mkdir(abs, { recursive: false });
  getDb().prepare("INSERT OR IGNORE INTO imported_folders (folder_name) VALUES (?)").run(n);
}

async function invalidateCacheForRel(rel: string, keySuffix = "") {
  const { thumb, web } = cachePathsForRel(rel, keySuffix);
  try {
    await fs.unlink(thumb);
  } catch {
    /* */
  }
  try {
    await fs.unlink(web);
  } catch {
    /* */
  }
}

/** Delete `stem_b.ext` next to the primary (and its sidecar if any). Clears back WebP cache. */
export async function deleteBackScanForPrimary(primaryRel: string) {
  const primaryAbs = resolveSafeUnderRoot(primaryRel);
  if (!primaryAbs) throw new Error("Invalid path");
  const ext = path.extname(primaryAbs);
  const stem = path.basename(primaryAbs, ext);
  const expectedName = `${stem}_b${ext}`;
  const backAbs = backAbsFromPrimaryRel(primaryRel);
  if (!backAbs) throw new Error("No back scan on disk");
  if (path.basename(backAbs) !== expectedName) throw new Error("Unexpected back file");
  await fs.unlink(backAbs);
  try {
    await fs.unlink(sidecarAbs(backAbs));
  } catch {
    /* no sidecar */
  }
  await invalidateCacheForRel(primaryRel, "__back");
}

/** Drop cached WebP derivatives and rebuild from disk (e.g. after editing in Photoshop). */
export async function refreshDerivativesForPhoto(primaryRel: string) {
  const absPrimary = resolveSafeUnderRoot(primaryRel);
  if (!absPrimary) throw new Error("Invalid path");
  await invalidateCacheForRel(primaryRel);
  await invalidateCacheForRel(primaryRel, "__back");
  const folderName = folderFromRelPath(primaryRel);
  const dirAbs = folderName ? path.join(config.photoRoot, folderName) : config.photoRoot;
  const names = await fs.readdir(dirAbs);
  const groups = groupFolderImages(names, folderName);
  const fname = path.posix.basename(primaryRel);
  const g = groups.find((x) => x.filename === fname);
  if (!g) throw new Error("Photo not found on disk");
  await syncOneAsset(g);
}

function syncDbPathsAfterBulkRename(moves: { fromRel: string; toRel: string }[]) {
  const db = getDb();
  for (const m of moves) {
    const row = db.prepare("SELECT id FROM assets WHERE rel_path = ?").get(m.fromRel) as
      | { id: string }
      | undefined;
    if (row) {
      const fname = path.posix.basename(m.toRel);
      const folderName = folderFromRelPath(m.toRel);
      db.prepare(
        `UPDATE assets SET rel_path = ?, filename = ?, folder_name = ?, scanned_at = datetime('now') WHERE id = ?`,
      ).run(m.toRel, fname, folderName, row.id);
    }
  }
}

/**
 * Rename folder and renumber primary + `_a` / `_b` companions.
 * Folder on disk keeps the display name (e.g. `My Trip`); files use underscores (`My_Trip_001.ext`).
 */
export async function renameFolder(oldName: string, newName: string) {
  const o = assertValidFolderName(oldName);
  const n = assertValidFolderName(newName);
  if (o === n) return;
  const oldAbs = path.join(config.photoRoot, o);
  const newAbs = path.join(config.photoRoot, n);
  await fs.rename(oldAbs, newAbs);

  const sub = await fs.readdir(newAbs, { withFileTypes: true });
  const fileNames = sub.filter((f) => f.isFile()).map((f) => f.name);
  const groups = groupFolderImages(fileNames, n);
  const padLen = Math.max(3, String(groups.length).length);
  const stem = folderStemForRenumberedFiles(n);

  type Move = { from: string; to: string; fromRel: string; toRel: string };
  const moves: Move[] = [];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    const seq = String(i + 1).padStart(padLen, "0");
    const extP = path.extname(g.filename);
    const baseStem = `${stem}_${seq}`;
    const targetPrimary = `${baseStem}${extP}`;
    const slotA = g.thumbSourceRel !== g.relPath ? path.basename(g.thumbSourceRel) : null;
    const slotB = g.backRelPath ? path.basename(g.backRelPath) : null;

    if (g.filename !== targetPrimary) {
      moves.push({
        from: path.join(newAbs, g.filename),
        to: path.join(newAbs, targetPrimary),
        fromRel: `${n}/${g.filename}`,
        toRel: `${n}/${targetPrimary}`,
      });
    }
    if (slotA) {
      const extA = path.extname(slotA);
      const targetAName = `${baseStem}_a${extA}`;
      if (slotA !== targetAName) {
        moves.push({
          from: path.join(newAbs, slotA),
          to: path.join(newAbs, targetAName),
          fromRel: `${n}/${slotA}`,
          toRel: `${n}/${targetAName}`,
        });
      }
    }
    if (slotB) {
      const extB = path.extname(slotB);
      const targetBName = `${baseStem}_b${extB}`;
      if (slotB !== targetBName) {
        moves.push({
          from: path.join(newAbs, slotB),
          to: path.join(newAbs, targetBName),
          fromRel: `${n}/${slotB}`,
          toRel: `${n}/${targetBName}`,
        });
      }
    }
  }

  const tmpSuffix = `.__tmp_rename_${Date.now()}`;
  for (const m of moves) {
    await fs.rename(m.from, m.from + tmpSuffix);
  }
  for (const m of moves) {
    await fs.rename(m.from + tmpSuffix, m.to);
    const oldSc = sidecarAbs(m.from);
    const newSc = sidecarAbs(m.to);
    try {
      await fs.rename(oldSc, newSc);
    } catch {
      /* no sidecar */
    }
    await invalidateCacheForRel(m.fromRel);
    await invalidateCacheForRel(m.fromRel, "__back");
  }

  syncDbPathsAfterBulkRename(moves.map((x) => ({ fromRel: x.fromRel, toRel: x.toRel })));
  getDb().prepare("UPDATE imported_folders SET folder_name = ? WHERE folder_name = ?").run(n, o);
  await syncAssetsFromDisk();
}

export async function movePhoto(fromRel: string, toFolder: string | null, newFilename?: string) {
  const from = resolveSafeUnderRoot(fromRel);
  if (!from) throw new Error("Invalid source path");

  let destDir = config.photoRoot;
  let destFolder: string | null = null;
  if (toFolder) {
    destFolder = assertValidFolderName(toFolder);
    destDir = path.join(config.photoRoot, destFolder);
    await fs.mkdir(destDir, { recursive: true });
    getDb().prepare("INSERT OR IGNORE INTO imported_folders (folder_name) VALUES (?)").run(destFolder);
  }

  const baseName = newFilename?.trim() || path.basename(from);
  if (baseName.includes("/") || baseName.includes("\\")) throw new Error("Invalid filename");
  const destAbs = path.join(destDir, baseName);

  const fromSc = sidecarAbs(from);
  const destSc = sidecarAbs(destAbs);
  const oldRel = toRelFromRoot(from);

  await fs.rename(from, destAbs);
  try {
    await fs.rename(fromSc, destSc);
  } catch {
    /* */
  }

  const newRel = toRelFromRoot(destAbs);
  const db = getDb();
  const row = db.prepare("SELECT id FROM assets WHERE rel_path = ?").get(oldRel) as { id: string } | undefined;
  if (row) {
    db.prepare(
      `UPDATE assets SET rel_path = ?, filename = ?, folder_name = ?, scanned_at = datetime('now') WHERE id = ?`,
    ).run(newRel, baseName, destFolder, row.id);
  }

  const names = await fs.readdir(destDir);
  const groups = groupFolderImages(names, destFolder);
  const g = groups.find((x) => x.filename === baseName);
  const displayAbs = g ? resolveSafeUnderRoot(g.thumbSourceRel) : null;
  const derivAbs = displayAbs ?? destAbs;

  await invalidateCacheForRel(oldRel);
  await invalidateCacheForRel(oldRel, "__back");
  await ensureDerivatives(derivAbs, newRel);
  const { thumb, web } = cachePathsForRel(newRel);
  const relThumb = path.relative(config.cacheDir, thumb);
  const relWeb = path.relative(config.cacheDir, web);
  if (row) {
    db.prepare(`UPDATE assets SET thumb_rel = ?, web_rel = ? WHERE id = ?`).run(relThumb, relWeb, row.id);
  }
}

export async function startFolderImport(folderName: string): Promise<string> {
  const n = assertValidFolderName(folderName);
  const imported = getImportedFolderNames();
  if (imported.has(n)) throw new Error("Folder already imported");
  const dirAbs = path.join(config.photoRoot, n);
  let names: string[];
  try {
    names = await fs.readdir(dirAbs);
  } catch {
    throw new Error("Folder not found on disk");
  }
  const primaries = groupFolderImages(names, n);
  const jobId = uuidv4();
  const db = getDb();
  db.prepare(
    `INSERT INTO import_jobs (id, folder_name, status, total, done, error)
     VALUES (?, ?, 'running', ?, 0, NULL)`,
  ).run(jobId, n, primaries.length);

  void runImportJob(jobId, n, primaries).catch((err) => {
    console.error("Import job failed:", err);
  });
  return jobId;
}

async function runImportJob(jobId: string, folderName: string, primaries: GroupedPrimary[]) {
  const db = getDb();
  try {
    for (let i = 0; i < primaries.length; i++) {
      await syncOneAsset(primaries[i]!);
      db.prepare("UPDATE import_jobs SET done = ? WHERE id = ?").run(i + 1, jobId);
    }
    db.prepare("INSERT OR REPLACE INTO imported_folders (folder_name) VALUES (?)").run(folderName);
    db.prepare("UPDATE import_jobs SET status = 'done' WHERE id = ?").run(jobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.prepare("UPDATE import_jobs SET status = 'error', error = ? WHERE id = ?").run(msg, jobId);
  }
}

export function getImportJob(id: string): ImportJobRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, folder_name, status, total, done, error, created_at
       FROM import_jobs WHERE id = ?`,
    )
    .get(id) as ImportJobRow | undefined;
  return row ?? null;
}
