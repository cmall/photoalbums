import { getDb } from "./db.js";
import type { GroupedPrimary } from "./photo-groups.js";

type AssetCatalogRow = {
  rel_path: string;
  filename: string;
  folder_name: string | null;
  thumb_source_rel: string | null;
  back_rel_path: string | null;
};

export function assetRowToGroupedPrimary(row: AssetCatalogRow): GroupedPrimary {
  return {
    relPath: row.rel_path,
    filename: row.filename,
    folder: row.folder_name,
    thumbSourceRel: row.thumb_source_rel ?? row.rel_path,
    backRelPath: row.back_rel_path,
  };
}

const ASSET_CATALOG_SQL = `SELECT rel_path, filename, folder_name, thumb_source_rel, back_rel_path FROM assets`;

/** Album photos from SQLite — no photo-root disk access. */
export function getFolderPhotosFromDb(folderName: string): GroupedPrimary[] {
  const rows = getDb()
    .prepare(`${ASSET_CATALOG_SQL} WHERE folder_name = ? ORDER BY filename COLLATE NOCASE`)
    .all(folderName) as AssetCatalogRow[];
  return rows.map(assetRowToGroupedPrimary);
}

export function getRootPhotosFromDb(): GroupedPrimary[] {
  const rows = getDb()
    .prepare(`${ASSET_CATALOG_SQL} WHERE folder_name IS NULL ORDER BY filename COLLATE NOCASE`)
    .all() as AssetCatalogRow[];
  return rows.map(assetRowToGroupedPrimary);
}
