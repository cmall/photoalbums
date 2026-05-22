import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import mime from "mime";
import { assertConfig, config } from "./config.js";
import { getDb } from "./db.js";
import {
  backAbsFromPrimaryRel,
  cachePathsForRel,
  displaySourceAbsFromPrimaryRel,
  imageAbsFromRel,
  photoMetadataFromDbRow,
  readSidecarJson,
  writeSidecarJson,
} from "./metadata.js";
import { ensureDerivatives } from "./images.js";
import {
  createFolder,
  deleteBackScanForPrimary,
  getFolderPhotos,
  getImportJob,
  getLibrary,
  getLibrarySummary,
  getRootPhotosFromDisk,
  getUnimportedFoldersOnDisk,
  movePhoto,
  refreshDerivativesForPhoto,
  renameFolder,
  startFolderImport,
  getSyncStatus,
  syncAssetsFromDisk,
} from "./library.js";
import { defaultYearForFolder } from "./folder-default-year.js";
import { openFileInPhotoshop, resolveAbsForExternalEditor } from "./open-photoshop.js";
import { loadLibraryEnrichmentForRels } from "./library-enrich.js";
import { registerAuth } from "./auth.js";

const trimEmpty = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);

const MetadataPatch = z.object({
  date: trimEmpty,
  location: trimEmpty,
  description: trimEmpty,
});

const MoveBody = z.object({
  fromRel: z.string(),
  toFolder: z.string().nullable(),
  newFilename: z.string().optional(),
});

const FolderCreate = z.object({
  name: z.string(),
});

const FolderRename = z.object({
  oldName: z.string(),
  newName: z.string(),
});

const FolderImportBody = z.object({
  folderName: z.string(),
});

const PersonCreate = z.object({
  full_name: z.string().min(1),
});

const TagCreate = z.object({
  relPath: z.string(),
  personId: z.string().min(1),
  normX: z.number().min(0).max(1),
  normY: z.number().min(0).max(1),
  normW: z.number().min(0).max(1).optional(),
  normH: z.number().min(0).max(1).optional(),
});

const TagPositionBody = z.object({
  tagId: z.string().min(1),
  normX: z.number().min(0).max(1),
  normY: z.number().min(0).max(1),
});

const OpenPhotoshopBody = z.object({
  rel: z.string(),
  variant: z.enum(["enhanced", "primary", "back"]).default("enhanced"),
});

const RefreshDerivativesBody = z.object({
  rel: z.string(),
});

const DeleteBackScanBody = z.object({
  rel: z.string(),
});

export async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true, credentials: true });
  await registerAuth(app);

  app.get("/api/health", async () => ({
    ok: true,
    openInPhotoshop: config.openInPhotoshopEnabled,
    sync: getSyncStatus(),
  }));

  app.post("/api/open-photoshop", async (req, reply) => {
    if (!config.openInPhotoshopEnabled) {
      return reply.status(404).send({
        error: "Open in Photoshop is disabled. Set ENABLE_OPEN_IN_PHOTOSHOP=1 in .env for local use.",
      });
    }
    const b = OpenPhotoshopBody.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    const abs = resolveAbsForExternalEditor(b.data.rel, b.data.variant);
    if (!abs) {
      return reply
        .status(404)
        .send({ error: "File not found or this view has no image on disk (e.g. missing back scan)." });
    }
    try {
      await fs.access(abs);
    } catch {
      return reply.status(404).send({ error: "File not found on disk" });
    }
    try {
      await openFileInPhotoshop(abs);
      return { ok: true };
    } catch (e) {
      req.log.error(e);
      return reply.status(500).send({ error: String(e) });
    }
  });

  app.post("/api/refresh-derivatives", async (req, reply) => {
    const b = RefreshDerivativesBody.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    try {
      await refreshDerivativesForPhoto(b.data.rel);
      return { ok: true };
    } catch (e) {
      return reply.status(400).send({ error: String(e) });
    }
  });

  app.post("/api/delete-back-scan", async (req, reply) => {
    const b = DeleteBackScanBody.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    try {
      await deleteBackScanForPrimary(b.data.rel);
      return { ok: true };
    } catch (e) {
      return reply.status(400).send({ error: String(e) });
    }
  });

  app.get("/api/library/summary", async () => {
    const db = getDb();
    const summary = getLibrarySummary();
    return {
      rootDefaultYear: defaultYearForFolder(db, null),
      rootPhotoCount: summary.rootPhotoCount,
      rootPreviewPhotos: summary.rootPreviewPhotos,
      folders: summary.folders.map((f) => ({
        ...f,
        defaultYear: defaultYearForFolder(db, f.name),
      })),
    };
  });

  app.get("/api/library/unimported", async () => {
    const db = getDb();
    const folders = await getUnimportedFoldersOnDisk();
    return {
      folders: folders.map((f) => ({
        ...f,
        defaultYear: defaultYearForFolder(db, f.name),
      })),
    };
  });

  app.get("/api/library/album", async (req, reply) => {
    const q = req.query as { folder?: string };
    const folder = q.folder?.trim();
    if (!folder) return reply.status(400).send({ error: "folder required" });
    const db = getDb();
    const photos = await getFolderPhotos(folder);
    const { enrich } = loadLibraryEnrichmentForRels(
      db,
      photos.map((p) => p.relPath),
    );
    return {
      folder,
      defaultYear: defaultYearForFolder(db, folder),
      photos: enrich(photos),
    };
  });

  app.get("/api/library/root-photos", async () => {
    const db = getDb();
    const photos = await getRootPhotosFromDisk();
    const { enrich } = loadLibraryEnrichmentForRels(
      db,
      photos.map((p) => p.relPath),
    );
    return {
      rootDefaultYear: defaultYearForFolder(db, null),
      photos: enrich(photos),
    };
  });

  /** @deprecated Prefer /api/library/summary plus per-album loads. */
  app.get("/api/library", async (req, reply) => {
    const q = req.query as { sync?: string; folder?: string };
    if (q.folder?.trim()) {
      req.log.warn("GET /api/library?folder= is deprecated; use /api/library/album");
      const folder = q.folder.trim();
      const db = getDb();
      const photos = await getFolderPhotos(folder);
      const { enrich } = loadLibraryEnrichmentForRels(
        db,
        photos.map((p) => p.relPath),
      );
      return {
        rootDefaultYear: defaultYearForFolder(db, null),
        rootPhotos: [],
        folders: [
          {
            name: folder,
            defaultYear: defaultYearForFolder(db, folder),
            photos: enrich(photos),
            needsImport: false,
            photoCount: photos.length,
          },
        ],
      };
    }
    if (q.sync === "1") void syncAssetsFromDisk();
    reply.header("X-Albums-Deprecated", "use /api/library/summary");
    const db = getDb();
    const summary = getLibrarySummary();
    return {
      rootDefaultYear: defaultYearForFolder(db, null),
      rootPhotoCount: summary.rootPhotoCount,
      rootPreviewPhotos: summary.rootPreviewPhotos,
      folders: summary.folders.map((f) => ({
        name: f.name,
        defaultYear: defaultYearForFolder(db, f.name),
        photoCount: f.photoCount,
        previewPhotos: f.previewPhotos,
        needsImport: f.needsImport,
        diskPhotoCount: f.diskPhotoCount,
        photos: f.previewPhotos,
      })),
      rootPhotos: summary.rootPreviewPhotos,
    };
  });

  app.post("/api/library/sync", async () => {
    await syncAssetsFromDisk();
    return { ok: true };
  });

  app.post("/api/folders", async (req, reply) => {
    const b = FolderCreate.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    try {
      await createFolder(b.data.name);
      await syncAssetsFromDisk();
      return { ok: true };
    } catch (e) {
      return reply.status(400).send({ error: String(e) });
    }
  });

  app.post("/api/folders/import", async (req, reply) => {
    const b = FolderImportBody.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    try {
      const jobId = await startFolderImport(b.data.folderName);
      return { jobId };
    } catch (e) {
      return reply.status(400).send({ error: String(e) });
    }
  });

  app.get("/api/import/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getImportJob(id);
    if (!job) return reply.status(404).send({ error: "not found" });
    return {
      id: job.id,
      folderName: job.folder_name,
      status: job.status,
      total: job.total,
      done: job.done,
      error: job.error,
    };
  });

  app.patch("/api/folders", async (req, reply) => {
    const b = FolderRename.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    try {
      await renameFolder(b.data.oldName, b.data.newName);
      return { ok: true };
    } catch (e) {
      return reply.status(400).send({ error: String(e) });
    }
  });

  app.post("/api/move", async (req, reply) => {
    const b = MoveBody.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    try {
      await movePhoto(b.data.fromRel, b.data.toFolder, b.data.newFilename);
      await syncAssetsFromDisk();
      return { ok: true };
    } catch (e) {
      return reply.status(400).send({ error: String(e) });
    }
  });

  app.get("/api/metadata", async (req, reply) => {
    const q = req.query as { rel?: string };
    if (!q.rel) return reply.status(400).send({ error: "rel required" });
    const abs = imageAbsFromRel(q.rel);
    if (!abs) return reply.status(404).send({ error: "not found" });
    return readSidecarJson(abs);
  });

  app.patch("/api/metadata", async (req, reply) => {
    const q = req.query as { rel?: string };
    if (!q.rel) return reply.status(400).send({ error: "rel required" });
    const abs = imageAbsFromRel(q.rel);
    if (!abs) return reply.status(404).send({ error: "not found" });
    const b = MetadataPatch.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    await writeSidecarJson(abs, b.data);
    await syncAssetsFromDisk();
    return readSidecarJson(abs);
  });

  app.get("/api/persons", async (req) => {
    const q = req.query as { q?: string; limit?: string };
    const term = (q.q ?? "").trim();
    const limit = Math.min(50, Number(q.limit ?? 20) || 20);
    const db = getDb();
    if (!term) {
      const rows = db
        .prepare(
          `SELECT id, full_name as fullName FROM persons ORDER BY full_name COLLATE NOCASE LIMIT ?`,
        )
        .all(limit) as { id: string; fullName: string }[];
      return { persons: rows };
    }
    const pattern = `%${term.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const rows = db
      .prepare(
        `SELECT id, full_name as fullName FROM persons
         WHERE full_name LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY full_name COLLATE NOCASE LIMIT ?`,
      )
      .all(pattern, limit) as { id: string; fullName: string }[];
    return { persons: rows };
  });

  app.post("/api/persons", async (req, reply) => {
    const b = PersonCreate.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    const name = b.data.full_name.trim().replace(/\s+/g, " ");
    const db = getDb();
    const existing = db
      .prepare("SELECT id, full_name as fullName FROM persons WHERE lower(full_name) = lower(?)")
      .get(name) as { id: string; fullName: string } | undefined;
    if (existing) return existing;
    const id = uuidv4();
    db.prepare("INSERT INTO persons (id, full_name) VALUES (?, ?)").run(id, name);
    return { id, fullName: name };
  });

  app.get("/api/persons/:id/photos", async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT a.rel_path as relPath, a.filename, a.folder_name as folder
         FROM person_tags t
         JOIN assets a ON a.id = t.asset_id
         WHERE t.person_id = ?
         ORDER BY a.rel_path`,
      )
      .all(id) as { relPath: string; filename: string; folder: string | null }[];
    if (!rows.length) {
      const p = db.prepare("SELECT id FROM persons WHERE id = ?").get(id);
      if (!p) return reply.status(404).send({ error: "person not found" });
    }
    return { photos: rows };
  });

  app.get("/api/tags", async (req, reply) => {
    const q = req.query as { rel?: string };
    if (!q.rel) return reply.status(400).send({ error: "rel required" });
    const db = getDb();
    const asset = db.prepare("SELECT id FROM assets WHERE rel_path = ?").get(q.rel) as
      | { id: string }
      | undefined;
    if (!asset) return { tags: [] };
    const tags = db
      .prepare(
        `SELECT t.id as tagId, t.person_id as personId, p.full_name as fullName,
         t.norm_x as normX, t.norm_y as normY, t.norm_w as normW, t.norm_h as normH
         FROM person_tags t
         JOIN persons p ON p.id = t.person_id
         WHERE t.asset_id = ?`,
      )
      .all(asset.id) as {
      tagId: string;
      personId: string;
      fullName: string;
      normX: number;
      normY: number;
      normW: number | null;
      normH: number | null;
    }[];
    return { tags };
  });

  app.post("/api/tags", async (req, reply) => {
    const b = TagCreate.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    const db = getDb();
    const asset = db
      .prepare("SELECT id FROM assets WHERE rel_path = ?")
      .get(b.data.relPath) as { id: string } | undefined;
    if (!asset) return reply.status(404).send({ error: "asset not found; sync library first" });
    const person = db
      .prepare("SELECT id FROM persons WHERE id = ?")
      .get(b.data.personId) as { id: string } | undefined;
    if (!person) return reply.status(404).send({ error: "person not found" });
    const tid = uuidv4();
    db.prepare(
      `INSERT INTO person_tags (id, asset_id, person_id, norm_x, norm_y, norm_w, norm_h)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      tid,
      asset.id,
      b.data.personId,
      b.data.normX,
      b.data.normY,
      b.data.normW ?? null,
      b.data.normH ?? null,
    );
    return { tagId: tid };
  });

  app.post("/api/tag-position", async (req, reply) => {
    const b = TagPositionBody.safeParse(req.body);
    if (!b.success) return reply.status(400).send(b.error.flatten());
    const db = getDb();
    const r = db
      .prepare("UPDATE person_tags SET norm_x = ?, norm_y = ? WHERE id = ?")
      .run(b.data.normX, b.data.normY, b.data.tagId);
    if (r.changes === 0) return reply.status(404).send({ error: "tag not found" });
    return { ok: true };
  });

  app.delete("/api/tags/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const r = db.prepare("DELETE FROM person_tags WHERE id = ?").run(id);
    if (r.changes === 0) return reply.status(404).send({ error: "not found" });
    return { ok: true };
  });

  app.get("/api/media", async (req, reply) => {
    const q = req.query as { rel?: string; variant?: string };
    if (!q.rel) return reply.status(400).send({ error: "rel required" });
    const variant = q.variant ?? "web";
    const primaryRel = q.rel;

    if (variant === "original") {
      const abs = imageAbsFromRel(primaryRel);
      if (!abs) return reply.status(404).send({ error: "not found" });
      const ext = path.extname(abs);
      const ctype = mime.getType(ext) ?? "application/octet-stream";
      const stream = fsSync.createReadStream(abs);
      return reply
        .header("Cache-Control", "private, max-age=0, must-revalidate")
        .header("Content-Disposition", `attachment; filename="${path.basename(abs)}"`)
        .type(ctype)
        .send(stream);
    }

    /** Unsuffixed scan for in-browser preview (same file as download `original`, without attachment). */
    if (variant === "primary") {
      const abs = imageAbsFromRel(primaryRel);
      if (!abs) return reply.status(404).send({ error: "not found" });
      const ext = path.extname(abs);
      const ctype = mime.getType(ext) ?? "application/octet-stream";
      const stream = fsSync.createReadStream(abs);
      return reply
        .header("Cache-Control", "private, max-age=0, must-revalidate")
        .type(ctype)
        .send(stream);
    }

    if (variant === "back") {
      const backAbs = backAbsFromPrimaryRel(primaryRel);
      if (!backAbs) return reply.status(404).send({ error: "no back scan" });
      await ensureDerivatives(backAbs, primaryRel, "__back");
      const { web } = cachePathsForRel(primaryRel, "__back");
      try {
        await fs.access(web);
      } catch {
        return reply.status(404).send({ error: "derivative missing" });
      }
      const stream = fsSync.createReadStream(web);
      return reply
        .header("Cache-Control", "private, max-age=0, must-revalidate")
        .type("image/webp")
        .send(stream);
    }

    const displayAbs = displaySourceAbsFromPrimaryRel(primaryRel);
    if (!displayAbs) return reply.status(404).send({ error: "not found" });
    await ensureDerivatives(displayAbs, primaryRel);
    const { thumb, web } = cachePathsForRel(primaryRel);
    const target = variant === "thumb" ? thumb : web;
    try {
      await fs.access(target);
    } catch {
      return reply.status(404).send({ error: "derivative missing" });
    }
    const stream = fsSync.createReadStream(target);
    return reply
      .header("Cache-Control", "private, max-age=0, must-revalidate")
      .type("image/webp")
      .send(stream);
  });

  const clientDist = path.join(process.cwd(), "../client/dist");
  if (fsSync.existsSync(path.join(clientDist, "index.html"))) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: "/",
    });
  }

  return app;
}

export async function start() {
  assertConfig();
  getDb();
  await fs.mkdir(config.cacheDir, { recursive: true });
  const server = await buildServer();
  server.log.info(
    {
      photoRoot: config.photoRoot,
      dbPath: config.dbPath,
      cacheDir: config.cacheDir,
      port: config.port,
      host: config.host,
    },
    "Albums server config",
  );
  await server.listen({ port: config.port, host: config.host });
  /** Defer thumbnail sync so API requests are not competing with disk I/O on startup. */
  const syncDelayMs = Number(
    process.env.SYNC_START_DELAY_MS ?? (process.env.NODE_ENV === "production" ? 120_000 : 5_000),
  );
  setTimeout(() => {
    void syncAssetsFromDisk().catch((err) => {
      console.error("Background library sync failed:", err);
      server.log.error({ err }, "Background library sync failed");
    });
  }, syncDelayMs);
  server.log.info({ syncDelayMs }, "Background library sync scheduled");
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
