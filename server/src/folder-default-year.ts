import type Database from "better-sqlite3";
import { parseYearFromStored } from "./photo-date.js";

function parseYearFromDateString(s: string): number | null {
  return parseYearFromStored(s);
}

/** Year from the most recently edited asset in this row (metadata date first, else sidecar mtime). */
function yearFromRow(row: {
  json_mtime: number | null;
  event_date: string | null;
}): number | null {
  if (row.event_date) {
    const y = parseYearFromDateString(row.event_date);
    if (y != null) return y;
  }
  if (row.json_mtime != null && !Number.isNaN(row.json_mtime)) {
    return new Date(row.json_mtime).getFullYear();
  }
  return null;
}

/**
 * Default calendar year for new dates in this album: derived from the most recently
 * edited photo in the folder (root when folderName is null).
 */
export function defaultYearForFolder(db: Database.Database, folderName: string | null): number | null {
  const rows = db
    .prepare(
      `SELECT json_mtime, event_date FROM assets
       WHERE (@f IS NULL AND folder_name IS NULL) OR (@f IS NOT NULL AND folder_name = @f)
       ORDER BY (json_mtime IS NULL), json_mtime DESC, rel_path`,
    )
    .all({ f: folderName }) as { json_mtime: number | null; event_date: string | null }[];

  for (const row of rows) {
    const y = yearFromRow(row);
    if (y != null) return y;
  }
  return null;
}
