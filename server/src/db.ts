import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

let db: Database.Database | null = null;

function migrateAssetsMetadataColumns(database: Database.Database) {
  const cols = database.prepare("PRAGMA table_info(assets)").all() as { name: string }[];
  const has = new Set(cols.map((c) => c.name));
  if (!has.has("event_date")) database.exec("ALTER TABLE assets ADD COLUMN event_date TEXT");
  if (!has.has("location")) database.exec("ALTER TABLE assets ADD COLUMN location TEXT");
  if (!has.has("description")) database.exec("ALTER TABLE assets ADD COLUMN description TEXT");
  if (!has.has("caption")) database.exec("ALTER TABLE assets ADD COLUMN caption TEXT");
}

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_persons_name ON persons(full_name);

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      rel_path TEXT NOT NULL UNIQUE,
      folder_name TEXT,
      filename TEXT NOT NULL,
      ext TEXT NOT NULL,
      thumb_rel TEXT,
      web_rel TEXT,
      width INTEGER,
      height INTEGER,
      json_mtime INTEGER,
      event_date TEXT,
      location TEXT,
      description TEXT,
      caption TEXT,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder_name);

    CREATE TABLE IF NOT EXISTS person_tags (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      norm_x REAL NOT NULL,
      norm_y REAL NOT NULL,
      norm_w REAL,
      norm_h REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tags_person ON person_tags(person_id);
    CREATE INDEX IF NOT EXISTS idx_tags_asset ON person_tags(asset_id);
  `);
  migrateAssetsMetadataColumns(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS imported_folders (
      folder_name TEXT PRIMARY KEY,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      folder_name TEXT NOT NULL,
      status TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT OR IGNORE INTO imported_folders (folder_name)
     SELECT DISTINCT folder_name FROM assets WHERE folder_name IS NOT NULL`,
  ).run();
  return db;
}

export type ImportJobRow = {
  id: string;
  folder_name: string;
  status: string;
  total: number;
  done: number;
  error: string | null;
  created_at: string;
};

export type PersonRow = {
  id: string;
  full_name: string;
  created_at: string;
};

export type AssetRow = {
  id: string;
  rel_path: string;
  folder_name: string | null;
  filename: string;
  ext: string;
  thumb_rel: string | null;
  web_rel: string | null;
  width: number | null;
  height: number | null;
  json_mtime: number | null;
  event_date: string | null;
  location: string | null;
  description: string | null;
};

export type PersonTagRow = {
  id: string;
  asset_id: string;
  person_id: string;
  norm_x: number;
  norm_y: number;
  norm_w: number | null;
  norm_h: number | null;
};
