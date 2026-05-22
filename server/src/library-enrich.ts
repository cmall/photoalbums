import type Database from "better-sqlite3";
import { photoMetadataFromDbRow } from "./metadata.js";
import type { GroupedPrimary } from "./photo-groups.js";

type TagRow = {
  relPath: string;
  personId: string;
  fullName: string;
  tagId: string;
  normX: number;
  normY: number;
  normW: number | null;
  normH: number | null;
};

type DbMetaRow = {
  rel_path: string;
  event_date: string | null;
  location: string | null;
  description: string | null;
};

function buildEnrichmentMaps(metaFor: TagRow[], dbMetaRows: DbMetaRow[]) {
  const tagsByRel = new Map<string, TagRow[]>();
  for (const row of metaFor) {
    const arr = tagsByRel.get(row.relPath) ?? [];
    arr.push(row);
    tagsByRel.set(row.relPath, arr);
  }

  const metaByRel = new Map<string, ReturnType<typeof photoMetadataFromDbRow>>();
  for (const r of dbMetaRows) {
    metaByRel.set(
      r.rel_path,
      photoMetadataFromDbRow({
        event_date: r.event_date,
        location: r.location,
        description: r.description,
      }),
    );
  }

  const sortTags = (relPath: string) =>
    [...(tagsByRel.get(relPath) ?? [])].sort((a, b) => a.normX - b.normX);

  const enrich = (photos: GroupedPrimary[]) =>
    photos.map((ph) => ({
      ...ph,
      metadata: metaByRel.get(ph.relPath) ?? {},
      tags: sortTags(ph.relPath),
    }));

  return { enrich };
}

/** Load tags + metadata only for the given primary rel paths. */
export function loadLibraryEnrichmentForRels(db: Database.Database, relPaths: string[]) {
  if (relPaths.length === 0) {
    return {
      enrich: (photos: GroupedPrimary[]) =>
        photos.map((ph) => ({ ...ph, metadata: {}, tags: [] as TagRow[] })),
    };
  }

  const placeholders = relPaths.map(() => "?").join(",");
  const metaFor = db
    .prepare(
      `SELECT a.rel_path as relPath, p.id as personId, p.full_name as fullName,
       t.id as tagId, t.norm_x as normX, t.norm_y as normY, t.norm_w as normW, t.norm_h as normH
       FROM person_tags t
       JOIN assets a ON a.id = t.asset_id
       JOIN persons p ON p.id = t.person_id
       WHERE a.rel_path IN (${placeholders})`,
    )
    .all(...relPaths) as TagRow[];

  const dbMetaRows = db
    .prepare(
      `SELECT rel_path, event_date, location, description FROM assets
       WHERE rel_path IN (${placeholders})`,
    )
    .all(...relPaths) as DbMetaRow[];

  return buildEnrichmentMaps(metaFor, dbMetaRows);
}

/** @deprecated Prefer loadLibraryEnrichmentForRels scoped to one album. */
export function loadLibraryEnrichment(db: Database.Database) {
  const metaFor = db
    .prepare(
      `SELECT a.rel_path as relPath, p.id as personId, p.full_name as fullName,
       t.id as tagId, t.norm_x as normX, t.norm_y as normY, t.norm_w as normW, t.norm_h as normH
       FROM person_tags t
       JOIN assets a ON a.id = t.asset_id
       JOIN persons p ON p.id = t.person_id`,
    )
    .all() as TagRow[];

  const dbMetaRows = db
    .prepare(`SELECT rel_path, event_date, location, description FROM assets`)
    .all() as DbMetaRow[];

  return buildEnrichmentMaps(metaFor, dbMetaRows);
}
