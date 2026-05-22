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

  const tagsByRel = new Map<string, TagRow[]>();
  for (const row of metaFor) {
    const arr = tagsByRel.get(row.relPath) ?? [];
    arr.push(row);
    tagsByRel.set(row.relPath, arr);
  }

  const dbMetaRows = db
    .prepare(`SELECT rel_path, event_date, location, description FROM assets`)
    .all() as DbMetaRow[];
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
