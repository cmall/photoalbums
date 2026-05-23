import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import type { MouseEvent, PointerEvent } from "react";
import { GalleryLightbox } from "./GalleryLightbox";
import { MasonryGallery } from "./MasonryGallery";
import { GalleryAlbumHub } from "./GalleryAlbumHub";
import { ViewerImageZoom, fitViewerImage } from "./ViewerImageZoom";
import {
  AuthRequiredError,
  addTag,
  createFolder,
  createPerson,
  deleteTag,
  fetchHealth,
  fetchLibrarySummary,
  fetchAlbumPhotos,
  fetchPhotoByRel,
  fetchRootPhotosApi,
  fetchUnimportedFolders,
  syncLibraryApi,
  getImportJob,
  mediaUrl,
  patchMetadata,
  patchTagPosition,
  photosForPerson,
  openInPhotoshopApi,
  postMove,
  deleteBackScanApi,
  refreshDerivativesApi,
  renameFolder,
  searchPersons,
  startFolderImportApi,
  type LibraryFolder,
  type LibraryPhoto,
  type Person,
  type PhotoMetadata,
  type TagInfo,
} from "./api";
import { folderFromRel } from "./app-url";
import { PhotoDateEditor } from "./PhotoDateEditor";
import { PhotoThumb } from "./PhotoThumb";
import { sortPhotosByDate } from "./photo-date";
import { normalizeFolderFromSummary, normalizeLibraryPhoto } from "./normalize";
import { useAppRoute } from "./useAppRoute";

function useDebounced<T>(value: T, ms: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return d;
}

function PhotoTile({
  photo,
  onOpen,
  imageCacheEpoch = 0,
}: {
  photo: LibraryPhoto;
  onOpen: (p: LibraryPhoto) => void;
  imageCacheEpoch?: number;
}) {
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);
  const sortedTags = photo.tags ?? [];
  const showNamesUnderThumb = sortedTags.length > 0 && sortedTags.length <= 2;
  const showPeopleCount = sortedTags.length > 2;

  return (
    <div className="tile-wrap">
      <button type="button" className="tile" onClick={() => onOpen(photo)}>
        <div className="tile-img-box">
          <PhotoThumb src={mediaUrl(photo.relPath, "thumb", imageCacheEpoch)} />
          {showNamesUnderThumb &&
            sortedTags.map((t) => (
              <span
                key={t.tagId}
                className={"tile-dot" + (hoveredTagId === t.tagId ? " tile-dot-on" : "")}
                style={{ left: `${t.normX * 100}%`, top: `${t.normY * 100}%` }}
                aria-hidden
              />
            ))}
        </div>
      </button>
      {showNamesUnderThumb && (
        <div className="tile-names">
          {sortedTags.map((t, i) => (
            <Fragment key={t.tagId}>
              {i > 0 && <span className="tile-names-sep">·</span>}
              <span
                className="tile-name"
                onMouseEnter={() => setHoveredTagId(t.tagId)}
                onMouseLeave={() => setHoveredTagId(null)}
              >
                {t.fullName}
              </span>
            </Fragment>
          ))}
        </div>
      )}
      {showPeopleCount && (
        <div className="tile-names">
          <span className="tile-people-count">({sortedTags.length} people)</span>
        </div>
      )}
    </div>
  );
}

function findPhotoInFolders(
  rootPhotos: LibraryPhoto[],
  folders: LibraryFolder[],
  relPath: string,
): LibraryPhoto | null {
  for (const p of rootPhotos) {
    if (p.relPath === relPath) return p;
  }
  for (const folder of folders) {
    for (const p of folder.photos) {
      if (p.relPath === relPath) return p;
    }
    for (const p of folder.previewPhotos ?? []) {
      if (p.relPath === relPath) return p;
    }
  }
  return null;
}

function findFolder(folders: LibraryFolder[], name: string): LibraryFolder | undefined {
  if (!name) return undefined;
  return (
    folders.find((f) => f.name === name) ??
    folders.find((f) => f.name.toLowerCase() === name.toLowerCase())
  );
}

function previewPhotoFromRel(relPath: string): LibraryPhoto {
  const filename = relPath.split("/").pop() ?? relPath;
  const folder = relPath.includes("/") ? relPath.split("/")[0]! : null;
  return {
    relPath,
    filename,
    folder,
    thumbSourceRel: relPath,
    backRelPath: null,
    metadata: {},
    tags: [],
  };
}

type OpenAlbum = string;

type AlbumRowModel = {
  id: OpenAlbum;
  title: string;
  photos: LibraryPhoto[];
  photoCount: number;
  folderForRename: string;
  defaultYear: number | null;
  needsImport: boolean;
  diskPhotoCount: number;
};

type AppView = "gallery" | "manage";

export function App({ onAuthLost }: { onAuthLost?: () => void }) {
  const { route, navigate } = useAppRoute();
  const appView: AppView = route.kind === "manage-hub" || route.kind === "manage-album" ? "manage" : "gallery";
  const galleryScope = route.kind === "gallery-album" ? route.folder : "";
  const openAlbum = route.kind === "manage-album" ? route.folder : null;
  const lightboxIndex =
    route.kind === "gallery-album" && route.lightboxIndex != null ? route.lightboxIndex : null;

  const [rootPhotos, setRootPhotos] = useState<LibraryPhoto[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [renameState, setRenameState] = useState<{ folder: string; next: string } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [moveTarget, setMoveTarget] = useState<string>("");
  const [importJob, setImportJob] = useState<{ id: string; folder: string } | null>(null);
  const [importJobView, setImportJobView] = useState<{
    done: number;
    total: number;
    status: string;
    error: string | null;
  } | null>(null);

  const [personFilter, setPersonFilter] = useState<string>("");
  const debouncedFilter = useDebounced(personFilter, 250);
  const [personSuggestions, setPersonSuggestions] = useState<Person[]>([]);
  const [activePersonId, setActivePersonId] = useState<string | null>(null);
  const [filteredRels, setFilteredRels] = useState<Set<string> | null>(null);
  const [openInPhotoshopEnabled, setOpenInPhotoshopEnabled] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [imageCacheEpoch, setImageCacheEpoch] = useState(0);
  const bumpImageCache = useCallback(() => setImageCacheEpoch((n) => n + 1), []);
  const albumCacheRef = useRef<Map<string, LibraryPhoto[]>>(new Map());
  const [rootPhotosLoaded, setRootPhotosLoaded] = useState(false);
  const [fetchedViewerPhoto, setFetchedViewerPhoto] = useState<LibraryPhoto | null>(null);

  const applyAlbumPhotosToFolder = useCallback((folderName: string, photos: LibraryPhoto[]) => {
    albumCacheRef.current.set(folderName, photos);
    setFolders((prev) => {
      const row = findFolder(prev, folderName);
      const key = row?.name ?? folderName;
      return prev.map((f) => (f.name === key ? { ...f, photos, photosLoaded: true } : f));
    });
  }, []);

  const loadAlbumPhotos = useCallback(
    async (folderName: string): Promise<LibraryPhoto[]> => {
      const cached = albumCacheRef.current.get(folderName);
      if (cached) {
        applyAlbumPhotosToFolder(folderName, cached);
        return cached;
      }
      const photos = (await fetchAlbumPhotos(folderName)).map(normalizeLibraryPhoto);
      applyAlbumPhotosToFolder(folderName, photos);
      return photos;
    },
    [applyAlbumPhotosToFolder],
  );

  const loadRootPhotos = useCallback(async (): Promise<LibraryPhoto[]> => {
    if (rootPhotosLoaded) return rootPhotos;
    const photos = (await fetchRootPhotosApi()).map(normalizeLibraryPhoto);
    setRootPhotos(photos);
    setRootPhotosLoaded(true);
    return photos;
  }, [rootPhotos, rootPhotosLoaded]);

  const patchPhotoInState = useCallback((relPath: string, metadata: PhotoMetadata) => {
    const patch = (p: LibraryPhoto): LibraryPhoto =>
      p.relPath === relPath ? { ...p, metadata } : p;
    setRootPhotos((prev) => prev.map(patch));
    setFolders((prev) =>
      prev.map((f) => ({
        ...f,
        photos: f.photos.map(patch),
        previewPhotos: (f.previewPhotos ?? []).map(patch),
      })),
    );
    for (const [name, list] of albumCacheRef.current.entries()) {
      albumCacheRef.current.set(name, list.map(patch));
    }
  }, []);

  const load = useCallback(async (sync = false) => {
    setErr(null);
    setLibraryLoading(true);
    try {
      if (sync) void syncLibraryApi();
      const summary = await fetchLibrarySummary();
      albumCacheRef.current.clear();
      setRootPhotos(summary.rootPreviewPhotos.map(normalizeLibraryPhoto));
      setRootPhotosLoaded(false);
      setFolders(summary.folders.map(normalizeFolderFromSummary));
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        onAuthLost?.();
        return;
      }
      setErr(String(e));
    } finally {
      setLibraryLoading(false);
    }
  }, [onAuthLost]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function pollSync() {
      try {
        const h = await fetchHealth();
        if (cancelled) return;
        if (h.openInPhotoshop) setOpenInPhotoshopEnabled(true);
        const s = h.sync;
        if (s?.running && s.total > 0) {
          setSyncProgress({ done: s.done, total: s.total });
        } else {
          setSyncProgress(null);
        }
      } catch {
        /* ignore */
      }
    }
    void pollSync();
    const t = window.setInterval(() => void pollSync(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (route.kind !== "photo") {
      setFetchedViewerPhoto(null);
      return;
    }
    const found = findPhotoInFolders(rootPhotos, folders, route.rel);
    if (found) {
      setFetchedViewerPhoto(null);
      return;
    }
    let cancelled = false;
    void fetchPhotoByRel(route.rel)
      .then((p) => {
        if (!cancelled) setFetchedViewerPhoto(normalizeLibraryPhoto(p));
      })
      .catch((e) => {
        if (!cancelled && !(e instanceof AuthRequiredError)) {
          console.warn("Photo lookup failed:", e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route, rootPhotos, folders]);

  useEffect(() => {
    const folderName =
      route.kind === "gallery-album"
        ? route.folder
        : route.kind === "manage-album"
          ? route.folder
          : route.kind === "photo"
            ? folderFromRel(route.rel)
            : null;
    if (!folderName || libraryLoading) return;
    const row = findFolder(folders, folderName);
    if (row?.photosLoaded) return;
    const cached = albumCacheRef.current.get(folderName);
    if (cached) {
      applyAlbumPhotosToFolder(folderName, cached);
      return;
    }
    void loadAlbumPhotos(folderName).catch((e) => {
      if (!(e instanceof AuthRequiredError)) setErr(String(e));
    });
  }, [route, folders, libraryLoading, loadAlbumPhotos, applyAlbumPhotosToFolder]);

  /** Manage hub lists every photo in each album; summary only includes 4 previews per folder. */
  useEffect(() => {
    if (route.kind !== "manage-hub" || libraryLoading) return;
    const pending = folders.filter((f) => !f.needsImport && f.photoCount > 0 && !f.photosLoaded);
    if (pending.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const f of pending) {
        if (cancelled) return;
        try {
          await loadAlbumPhotos(f.name);
        } catch (e) {
          if (e instanceof AuthRequiredError) return;
          if (!cancelled) setErr(String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route, folders, libraryLoading, loadAlbumPhotos]);

  useEffect(() => {
    if (route.kind !== "photo" || folderFromRel(route.rel)) return;
    void loadRootPhotos().catch((e) => {
      if (!(e instanceof AuthRequiredError)) setErr(String(e));
    });
  }, [route, loadRootPhotos]);

  useEffect(() => {
    if (appView !== "manage") return;
    void fetchUnimportedFolders()
      .then((unimported) => {
        setFolders((prev) => {
          const byName = new Map(prev.map((f) => [f.name, f]));
          for (const u of unimported) {
            if (!byName.has(u.name)) byName.set(u.name, u);
          }
          return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
        });
      })
      .catch((e) => {
        if (e instanceof AuthRequiredError) return;
        console.warn("Unimported folder scan failed:", e);
      });
  }, [appView]);

  useEffect(() => {
    if (!importJob) {
      setImportJobView(null);
      return;
    }
    const jobId = importJob.id;
    let cancelled = false;
    async function poll() {
      try {
        const j = await getImportJob(jobId);
        if (cancelled) return;
        setImportJobView({
          done: j.done,
          total: j.total,
          status: j.status,
          error: j.error,
        });
        if (j.status === "done") {
          setImportJob(null);
          await load(true);
        } else if (j.status === "error") {
          setErr(j.error ?? "Import failed");
          setImportJob(null);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(String(e));
          setImportJob(null);
        }
      }
    }
    const t = window.setInterval(() => void poll(), 400);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [importJob, load]);

  useEffect(() => {
    if (!debouncedFilter.trim()) {
      setPersonSuggestions([]);
      return;
    }
    let cancelled = false;
    void searchPersons(debouncedFilter).then((rows) => {
      if (!cancelled) setPersonSuggestions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedFilter]);

  const applyFilter = useCallback((photos: LibraryPhoto[]) => {
    if (!filteredRels) return photos;
    return photos.filter((p) => filteredRels.has(p.relPath));
  }, [filteredRels]);

  const galleryAlbumHubEntries = useMemo(() => {
    const imported = folders.filter((f) => !f.needsImport);
    if (!filteredRels) {
      return imported
        .filter((f) => f.photoCount > 0)
        .map((f) => ({
          name: f.name,
          photoCount: f.photoCount,
          photos: (f.photosLoaded ? f.photos : f.previewPhotos ?? []).slice(0, 4),
        }));
    }
    const byFolder = new Map<string, string[]>();
    for (const rel of filteredRels) {
      const slash = rel.indexOf("/");
      if (slash <= 0) continue;
      const folder = rel.slice(0, slash);
      const arr = byFolder.get(folder) ?? [];
      arr.push(rel);
      byFolder.set(folder, arr);
    }
    return imported
      .filter((f) => byFolder.has(f.name))
      .map((f) => {
        const rels = byFolder.get(f.name)!;
        return {
          name: f.name,
          photoCount: rels.length,
          photos: rels.slice(0, 4).map(previewPhotoFromRel),
        };
      });
  }, [folders, filteredRels]);

  const galleryPhotos = useMemo(() => {
    if (galleryScope === "") return [];
    const folder = findFolder(folders, galleryScope);
    if (!folder || folder.needsImport) return [];
    const pool = folder.photosLoaded ? folder.photos : folder.previewPhotos ?? [];
    return sortPhotosByDate(applyFilter(pool));
  }, [folders, galleryScope, applyFilter]);

  const activeGalleryFolder = findFolder(folders, galleryScope);

  const galleryAlbumLoading =
    route.kind === "gallery-album" &&
    !libraryLoading &&
    !!activeGalleryFolder &&
    galleryPhotos.length === 0 &&
    !activeGalleryFolder.photosLoaded;

  const viewerPhoto = useMemo(() => {
    if (route.kind !== "photo") return null;
    return (
      findPhotoInFolders(rootPhotos, folders, route.rel) ??
      fetchedViewerPhoto ??
      previewPhotoFromRel(route.rel)
    );
  }, [route, rootPhotos, folders, fetchedViewerPhoto]);

  const albumRows: AlbumRowModel[] = useMemo(() => {
    return folders.map((f) => ({
      id: f.name,
      title: f.name,
      photos: sortPhotosByDate(f.photosLoaded ? applyFilter(f.photos) : f.previewPhotos ?? []),
      photoCount: f.photoCount,
      folderForRename: f.name,
      defaultYear: f.defaultYear,
      needsImport: f.needsImport,
      diskPhotoCount: f.diskPhotoCount ?? 0,
    }));
  }, [folders, applyFilter]);

  const visibleRows = useMemo(() => {
    if (openAlbum == null) return albumRows;
    return albumRows.filter((r) => r.id === openAlbum);
  }, [albumRows, openAlbum]);

  /** Photos in the same album as the open viewer (for prev/next within album only). */
  const viewerAlbumPhotos = useMemo(() => {
    if (route.kind !== "photo") return [];
    const folder = folderFromRel(route.rel);
    if (folder == null) return sortPhotosByDate(applyFilter(rootPhotos));
    const row = folders.find((f) => f.name === folder);
    const pool = row ? (row.photosLoaded ? row.photos : row.previewPhotos ?? []) : [];
    return sortPhotosByDate(applyFilter(pool));
  }, [route, rootPhotos, folders, applyFilter]);

  async function applyPersonFilter(person: Person) {
    setActivePersonId(person.id);
    setErr(null);
    try {
      const photos = await photosForPerson(person.id);
      setFilteredRels(new Set(photos.map((p) => p.relPath)));
    } catch (e) {
      setErr(String(e));
    }
  }

  function clearPersonFilter() {
    setActivePersonId(null);
    setFilteredRels(null);
    setPersonFilter("");
    setPersonSuggestions([]);
  }

  useEffect(() => {
    if (route.kind !== "gallery-album" || typeof route.lightboxIndex !== "number") return;
    if (galleryPhotos.length === 0) {
      navigate({ kind: "gallery-album", folder: route.folder }, true);
    } else if (route.lightboxIndex >= galleryPhotos.length) {
      navigate(
        { kind: "gallery-album", folder: route.folder, lightboxIndex: galleryPhotos.length - 1 },
        true,
      );
    }
  }, [galleryPhotos.length, route, navigate]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-bar">
          <h1>
            <button type="button" className="app-title-link" onClick={() => navigate({ kind: "gallery-hub" })}>
              Albums
            </button>
          </h1>
          <nav className="app-nav" aria-label="Primary views">
            <button
              type="button"
              className={appView === "gallery" ? "nav-tab active" : "nav-tab"}
              onClick={() => navigate({ kind: "gallery-hub" })}
            >
              Gallery
            </button>
            <button
              type="button"
              className={appView === "manage" ? "nav-tab active" : "nav-tab"}
              onClick={() => navigate({ kind: "manage-hub" })}
            >
              Album management
            </button>
          </nav>

          {appView === "gallery" && (
            <label className="header-field">
              <span className="header-field-label">Album</span>
              <select
                className="gallery-scope-select"
                value={galleryScope}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) navigate({ kind: "gallery-hub" });
                  else navigate({ kind: "gallery-album", folder: v });
                }}
                aria-label="Choose album to view"
              >
                <option value="">Album overview</option>
                {folders
                  .filter((f) => !f.needsImport)
                  .map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <label className="header-field header-field-grow">
            <span className="header-field-label">Photos with person</span>
            <input
              className="person-search"
              value={personFilter}
              placeholder="Start typing a full name…"
              onChange={(e) => {
                setPersonFilter(e.target.value);
                if (!e.target.value.trim()) clearPersonFilter();
              }}
              list="person-datalist"
            />
          </label>
          <datalist id="person-datalist">
            {personSuggestions.map((p) => (
              <option key={p.id} value={p.fullName} />
            ))}
          </datalist>
          {activePersonId && (
            <button type="button" className="ghost header-bar-btn" onClick={clearPersonFilter}>
              Clear filter
            </button>
          )}

          {appView === "manage" && (
            <>
              <input
                className="header-folder-input"
                placeholder="New folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
              />
              <button
                type="button"
                className="header-bar-btn"
                onClick={async () => {
                  try {
                    await createFolder(newFolderName);
                    setNewFolderName("");
                    await load(true);
                  } catch (e) {
                    setErr(String(e));
                  }
                }}
              >
                Create folder
              </button>
            </>
          )}
        </div>

        {personSuggestions.length > 0 && personFilter.trim() && !activePersonId && (
          <div className="header-suggestions">
            {personSuggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                className="sugg"
                onClick={() => void applyPersonFilter(p)}
              >
                {p.fullName}
              </button>
            ))}
          </div>
        )}
        {err && <div className="error">{err}</div>}
        {syncProgress && (
          <div className="sync-banner" aria-live="polite">
            Generating thumbnails… {syncProgress.done} / {syncProgress.total}
          </div>
        )}
      </header>

      <main className={appView === "gallery" ? "main-gallery" : "board"}>
        {appView === "gallery" ? (
          libraryLoading ? (
            <p className="gallery-empty">Loading library…</p>
          ) : galleryScope === "" ? (
            <GalleryAlbumHub
              albums={galleryAlbumHubEntries}
              imageCacheEpoch={imageCacheEpoch}
              onOpenPhoto={(folderName, idx) => {
                const entry = galleryAlbumHubEntries.find((a) => a.name === folderName);
                const relPath = entry?.photos[idx]?.relPath;
                if (!relPath) {
                  navigate({ kind: "gallery-album", folder: folderName });
                  return;
                }
                void loadAlbumPhotos(folderName)
                  .then((photos) => {
                    const i = photos.findIndex((p) => p.relPath === relPath);
                    navigate({
                      kind: "gallery-album",
                      folder: folderName,
                      lightboxIndex: i >= 0 ? i : 0,
                    });
                  })
                  .catch((e) => {
                    if (!(e instanceof AuthRequiredError)) setErr(String(e));
                  });
              }}
              onOpenAlbumGrid={(folderName) => {
                navigate({ kind: "gallery-album", folder: folderName });
              }}
            />
          ) : libraryLoading || !activeGalleryFolder ? (
            <p className="gallery-empty">Loading album…</p>
          ) : galleryAlbumLoading ? (
            <p className="gallery-empty">Loading album…</p>
          ) : activeGalleryFolder.needsImport ? (
            <p className="gallery-empty">This album has not been imported yet.</p>
          ) : (
            <MasonryGallery
              photos={galleryPhotos}
              imageCacheEpoch={imageCacheEpoch}
              onOpenIndex={(i) =>
                navigate({ kind: "gallery-album", folder: galleryScope, lightboxIndex: i })
              }
            />
          )
        ) : (
          <>
        {libraryLoading && (
          <p className="gallery-empty">Loading library…</p>
        )}
        {openAlbum != null && (
          <div className="album-nav">
            <button type="button" className="ghost back-all" onClick={() => navigate({ kind: "manage-hub" })}>
              ← All albums
            </button>
          </div>
        )}
        {visibleRows.map((row) => (
          <section key={row.id} className="album-row">
            <div className="album-row-head">
              <h2>{row.title}</h2>
              <span className="album-count">{row.photoCount} photos</span>
              <div className="album-row-actions">
                {row.needsImport ? (
                  importJob?.folder === row.folderForRename ? (
                    <div className="import-progress" aria-live="polite">
                      <progress
                        value={importJobView?.done ?? 0}
                        max={Math.max(importJobView?.total ?? 1, 1)}
                      />
                      <span className="import-progress-label">
                        Importing {importJobView?.done ?? 0} / {importJobView?.total ?? 0}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="small"
                      onClick={async () => {
                        setErr(null);
                        try {
                          const { jobId } = await startFolderImportApi(row.folderForRename);
                          setImportJob({ id: jobId, folder: row.folderForRename });
                        } catch (e) {
                          setErr(String(e));
                        }
                      }}
                    >
                      Import {row.diskPhotoCount} from disk
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => navigate({ kind: "manage-album", folder: row.id })}
                  >
                    Open album
                  </button>
                )}
                {!row.needsImport && (
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      setRenameState({ folder: row.folderForRename, next: row.folderForRename })
                    }
                  >
                    Rename &amp; renumber
                  </button>
                )}
              </div>
            </div>
            <div className="album-row-thumbs">
              {row.photos.map((p) => (
                <PhotoTile
                  key={p.relPath}
                  photo={p}
                  imageCacheEpoch={imageCacheEpoch}
                  onOpen={(ph) => navigate({ kind: "photo", rel: ph.relPath })}
                />
              ))}
            </div>
          </section>
        ))}
          </>
        )}
      </main>

      {lightboxIndex != null && galleryPhotos.length > 0 && (
        <GalleryLightbox
          photos={galleryPhotos}
          index={lightboxIndex}
          openInPhotoshopEnabled={openInPhotoshopEnabled}
          imageCacheEpoch={imageCacheEpoch}
          onDerivativesRefreshed={bumpImageCache}
          onClose={() => navigate({ kind: "gallery-album", folder: galleryScope })}
          onNavigate={(i) =>
            navigate({ kind: "gallery-album", folder: galleryScope, lightboxIndex: i })
          }
          onEditDetails={(p) => navigate({ kind: "photo", rel: p.relPath })}
        />
      )}

      {renameState && (
        <div className="modal-back" onClick={() => setRenameState(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Rename folder</h3>
            <p className="hint">
              Files inside will be renamed to{" "}
              <code>
                {(renameState.next ?? "").trim().split(/\s+/).filter(Boolean).join("_") || "Name"}
                _001.jpg
              </code>
              , etc. The folder on disk may include spaces; only filenames use underscores.
            </p>
            <input
              value={renameState.next}
              onChange={(e) =>
                setRenameState((s) => (s ? { ...s, next: e.target.value } : s))
              }
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setRenameState(null)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await renameFolder(renameState.folder, renameState.next);
                    setRenameState(null);
                    await load(true);
                  } catch (e) {
                    setErr(String(e));
                  }
                }}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerPhoto && (
        <ViewerModal
          photo={viewerPhoto}
          navPhotos={viewerAlbumPhotos}
          onSelectPhoto={(p) => navigate({ kind: "photo", rel: p.relPath }, true)}
          openInPhotoshopEnabled={openInPhotoshopEnabled}
          imageCacheEpoch={imageCacheEpoch}
          onDerivativesRefreshed={bumpImageCache}
          onClose={() => {
            const folder = folderFromRel(viewerPhoto.relPath);
            if (folder) navigate({ kind: "gallery-album", folder });
            else navigate({ kind: "gallery-hub" });
          }}
          moveTarget={moveTarget}
          setMoveTarget={setMoveTarget}
          folders={folders.map((f) => f.name)}
          onPhotoPatched={patchPhotoInState}
          onRefresh={() => load(true)}
        />
      )}
    </div>
  );
}

function ViewerModal({
  photo,
  navPhotos,
  onSelectPhoto,
  openInPhotoshopEnabled,
  imageCacheEpoch,
  onDerivativesRefreshed,
  onClose,
  moveTarget,
  setMoveTarget,
  folders,
  onPhotoPatched,
  onRefresh,
}: {
  photo: LibraryPhoto;
  navPhotos: LibraryPhoto[];
  onSelectPhoto: (p: LibraryPhoto) => void;
  openInPhotoshopEnabled: boolean;
  imageCacheEpoch: number;
  onDerivativesRefreshed: () => void;
  onClose: () => void;
  moveTarget: string;
  setMoveTarget: (s: string) => void;
  folders: string[];
  onPhotoPatched: (relPath: string, metadata: PhotoMetadata) => void;
  onRefresh: () => Promise<void>;
}) {
  const DRAG_THRESHOLD_PX = 8;

  const [meta, setMeta] = useState<PhotoMetadata>(photo.metadata);
  const [tagMode, setTagMode] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [nameInput, setNameInput] = useState("");
  const debouncedName = useDebounced(nameInput, 200);
  const [nameSuggestions, setNameSuggestions] = useState<Person[]>([]);
  const imgRef = useRef<HTMLImageElement>(null);
  const [hoveredViewerTagId, setHoveredViewerTagId] = useState<string | null>(null);
  const [dragOverride, setDragOverride] = useState<Record<string, { normX: number; normY: number }>>(
    () => ({}),
  );
  const markerDragRef = useRef<{
    tagId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
    lastNormX: number;
    lastNormY: number;
  } | null>(null);

  type ViewerImageSource = "enhanced" | "primary" | "back";
  const [imageSource, setImageSource] = useState<ViewerImageSource>("enhanced");
  const [refreshingPreview, setRefreshingPreview] = useState(false);
  const [deletingBack, setDeletingBack] = useState(false);
  const [viewScale, setViewScale] = useState(1);
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
  const hasBack = photo.backRelPath != null;
  const hasEnhanced = photo.thumbSourceRel !== photo.relPath;

  const viewerImgSrc = (() => {
    if (imageSource === "back" && hasBack) return mediaUrl(photo.relPath, "back", imageCacheEpoch);
    if (imageSource === "primary") return mediaUrl(photo.relPath, "primary", imageCacheEpoch);
    return mediaUrl(photo.relPath, "web", imageCacheEpoch);
  })();

  const displayTags = useMemo(() => {
    const merged = (photo.tags ?? []).map((t) => ({
      ...t,
      normX: dragOverride[t.tagId]?.normX ?? t.normX,
      normY: dragOverride[t.tagId]?.normY ?? t.normY,
    }));
    return merged.sort((a, b) => a.normX - b.normX);
  }, [photo.tags, dragOverride]);

  const navIndex = navPhotos.findIndex((p) => p.relPath === photo.relPath);
  const navLen = navPhotos.length;
  const canNavigate = navLen > 1;

  const goPhoto = useCallback(
    (delta: number) => {
      if (!canNavigate) return;
      const i = navPhotos.findIndex((p) => p.relPath === photo.relPath);
      if (i < 0) return;
      const j = (i + delta + navLen) % navLen;
      onSelectPhoto(navPhotos[j]!);
    },
    [canNavigate, navLen, navPhotos, photo.relPath, onSelectPhoto],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPhoto(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goPhoto(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPhoto]);

  function pointerClientToNorm(clientX: number, clientY: number) {
    const el = imgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const w = r.width || 1;
    const h = r.height || 1;
    const x = (clientX - r.left) / w;
    const y = (clientY - r.top) / h;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function handleMarkerPointerDown(e: PointerEvent<HTMLButtonElement>, t: TagInfo) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
    markerDragRef.current = {
      tagId: t.tagId,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      lastNormX: t.normX,
      lastNormY: t.normY,
    };
  }

  function handleMarkerPointerMove(e: PointerEvent<HTMLButtonElement>, t: TagInfo) {
    const d = markerDragRef.current;
    if (!d || d.tagId !== t.tagId || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;
    if (!d.moved && dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      d.moved = true;
    }
    if (!d.moved) return;
    const norm = pointerClientToNorm(e.clientX, e.clientY);
    if (!norm) return;
    d.lastNormX = norm.x;
    d.lastNormY = norm.y;
    setDragOverride((o) => ({ ...o, [t.tagId]: { normX: norm.x, normY: norm.y } }));
  }

  async function finishMarkerPointer(e: PointerEvent<HTMLButtonElement>, t: TagInfo) {
    const d = markerDragRef.current;
    if (!d || d.tagId !== t.tagId || d.pointerId !== e.pointerId) return;
    markerDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (d.moved) {
      try {
        await patchTagPosition(t.tagId, d.lastNormX, d.lastNormY);
      } catch (err) {
        console.error(err);
        window.alert(err instanceof Error ? err.message : String(err));
        return;
      }
      setDragOverride((o) => {
        const next = { ...o };
        delete next[t.tagId];
        return next;
      });
      onRefresh();
      return;
    }
    if (window.confirm(`Remove tag for ${t.fullName}?`)) {
      await deleteTag(t.tagId);
      onRefresh();
    }
  }

  useEffect(() => {
    setMeta(photo.metadata);
    setHoveredViewerTagId(null);
    setDragOverride({});
    markerDragRef.current = null;
    setImageSource("enhanced");
    setViewScale(1);
  }, [photo.relPath]);

  useEffect(() => {
    if (tagMode) {
      fitViewerImage(transformRef.current, imgRef.current);
      setViewScale(1);
    }
  }, [tagMode]);

  useEffect(() => {
    if (!debouncedName.trim()) {
      setNameSuggestions([]);
      return;
    }
    let c = false;
    void searchPersons(debouncedName).then((rows) => {
      if (!c) setNameSuggestions(rows);
    });
    return () => {
      c = true;
    };
  }, [debouncedName]);

  function onImageClick(e: MouseEvent<HTMLImageElement>) {
    if (imageSource !== "enhanced" || !tagMode || !imgRef.current) return;
    const el = imgRef.current;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setPending({ x, y });
    setNameInput("");
  }

  async function saveMeta(partial: Partial<PhotoMetadata>) {
    const next = await patchMetadata(photo.relPath, partial);
    setMeta(next);
    onPhotoPatched(photo.relPath, next);
  }

  async function submitTag(person: Person | null) {
    if (!pending) return;
    let p = person;
    const trimmed = nameInput.trim().replace(/\s+/g, " ");
    if (!p) {
      if (trimmed.length < 2) return;
      p = await createPerson(trimmed);
    }
    await addTag(photo.relPath, p.id, pending.x, pending.y);
    setPending(null);
    setNameInput("");
    setTagMode(false);
    onRefresh();
  }

  return (
    <div className="modal-back viewer-modal-back" onClick={onClose}>
      <div className="modal viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="viewer">
          <div className="viewer-primary">
            <ViewerImageZoom
              resetKey={`${photo.relPath}:${imageSource}`}
              interactionDisabled={tagMode}
              tagging={tagMode}
              onScaleChange={setViewScale}
              transformRef={transformRef}
              imageRef={imgRef}
              onBackgroundClick={() => tagMode && setPending(null)}
              header={
                <div className="viewer-nav" role="toolbar" aria-label="Photo navigation">
                  <button
                    type="button"
                    className="viewer-nav-btn"
                    disabled={!canNavigate}
                    onClick={() => goPhoto(-1)}
                    aria-label="Previous photo in album"
                  >
                    ‹
                  </button>
                  <span className="viewer-nav-pos">
                    {navLen === 0 ? "—" : navIndex >= 0 ? `${navIndex + 1} / ${navLen}` : `— / ${navLen}`}
                  </span>
                  <button
                    type="button"
                    className="viewer-nav-btn"
                    disabled={!canNavigate}
                    onClick={() => goPhoto(1)}
                    aria-label="Next photo in album"
                  >
                    ›
                  </button>
                </div>
              }
            >
              <img
                ref={imgRef}
                src={viewerImgSrc}
                alt=""
                className="viewer-img"
                onClick={(e) => {
                  e.stopPropagation();
                  onImageClick(e);
                }}
              />
              {imageSource === "enhanced" &&
              displayTags.map((t) => (
                <button
                  key={t.tagId}
                  type="button"
                  className={
                    "marker marker-face" +
                    (hoveredViewerTagId === t.tagId ? " marker-hovered" : "")
                  }
                  style={{ left: `${t.normX * 100}%`, top: `${t.normY * 100}%` }}
                  title={`Drag to move, or click to remove — ${t.fullName}`}
                  onPointerDown={(e) => handleMarkerPointerDown(e, t)}
                  onPointerMove={(e) => handleMarkerPointerMove(e, t)}
                  onPointerUp={(e) => void finishMarkerPointer(e, t)}
                  onPointerCancel={(e) => void finishMarkerPointer(e, t)}
                >
                  <span className="marker-dot" />
                </button>
              ))}
              {imageSource === "enhanced" && pending && (
                <span
                  className="marker pending"
                  style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}
                >
                  <span className="marker-dot" />
                </span>
              )}
            </ViewerImageZoom>
            <p className="viewer-nav-hint">← → album · scroll, pinch, or double-click to zoom</p>
            {displayTags.length > 0 && (
              <div className="viewer-names">
                {displayTags.map((t, i) => (
                  <Fragment key={t.tagId}>
                    {i > 0 && <span className="viewer-names-sep">·</span>}
                    <span
                      className="viewer-name"
                      onMouseEnter={() => setHoveredViewerTagId(t.tagId)}
                      onMouseLeave={() => setHoveredViewerTagId(null)}
                    >
                      {t.fullName}
                    </span>
                  </Fragment>
                ))}
              </div>
            )}
          </div>
          <aside className="side">
            <div className="viewer-main-actions">
              {hasBack && (
                <button
                  type="button"
                  className={"viewer-main-btn" + (imageSource === "back" ? " active" : "")}
                  onClick={() => {
                    setTagMode(false);
                    setPending(null);
                    setImageSource((s) => (s === "back" ? "enhanced" : "back"));
                  }}
                >
                  {imageSource === "back" ? "View front (enhanced)" : "View back of print"}
                </button>
              )}
              <button
                type="button"
                className={"viewer-main-btn" + (imageSource === "primary" ? " active" : "")}
                onClick={() => {
                  setTagMode(false);
                  setPending(null);
                  setImageSource((s) => (s === "primary" ? "enhanced" : "primary"));
                }}
              >
                {imageSource === "primary"
                  ? hasEnhanced
                    ? "View enhanced"
                    : "Compressed preview"
                  : "Original scan"}
              </button>
            </div>
            {hasBack && imageSource === "back" && (
              <button
                type="button"
                className="viewer-delete-back"
                disabled={deletingBack}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Delete the back-of-print scan file from disk? This cannot be undone.",
                    )
                  )
                    return;
                  setDeletingBack(true);
                  try {
                    await deleteBackScanApi(photo.relPath);
                    setImageSource("enhanced");
                    onDerivativesRefreshed();
                    await onRefresh();
                  } catch (e) {
                    window.alert(e instanceof Error ? e.message : String(e));
                  } finally {
                    setDeletingBack(false);
                  }
                }}
              >
                {deletingBack ? "Deleting…" : "Delete back scan"}
              </button>
            )}
            <div className="viewer-tool-actions">
              <a className="viewer-tool-btn" href={mediaUrl(photo.relPath, "original")}>
                Download original
              </a>
              {openInPhotoshopEnabled && (
                <button
                  type="button"
                  className="viewer-tool-btn"
                  onClick={async () => {
                    try {
                      await openInPhotoshopApi(photo.relPath, imageSource);
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  Open in Photoshop
                </button>
              )}
              <button
                type="button"
                className="viewer-tool-btn"
                disabled={refreshingPreview}
                onClick={async () => {
                  setRefreshingPreview(true);
                  try {
                    await refreshDerivativesApi(photo.relPath);
                    onDerivativesRefreshed();
                  } catch (e) {
                    window.alert(e instanceof Error ? e.message : String(e));
                  } finally {
                    setRefreshingPreview(false);
                  }
                }}
              >
                {refreshingPreview ? "Refreshing…" : "Refresh preview"}
              </button>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={tagMode}
                disabled={viewScale > 1.01}
                onChange={() => {
                  if (viewScale > 1.01) return;
                  setTagMode((v) => !v);
                  setPending(null);
                }}
              />
              Tag someone (click face next)
            </label>
            {viewScale > 1.01 && (
              <p className="hint tag-drag-hint">Reset zoom to Fit to tag faces.</p>
            )}
            <p className="hint tag-drag-hint">Drag a dot on the photo to reposition it, or click without dragging to remove.</p>
            {pending && (
              <div className="tag-form">
                <p className="hint">Who is here? Prefer a full name.</p>
                <input
                  className="person-search"
                  placeholder="e.g. Jordan Martinez"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  list="viewer-person-list"
                />
                <datalist id="viewer-person-list">
                  {nameSuggestions.map((p) => (
                    <option key={p.id} value={p.fullName} />
                  ))}
                </datalist>
                <div className="suggestions col">
                  {nameSuggestions.slice(0, 8).map((p) => (
                    <button key={p.id} type="button" className="sugg" onClick={() => submitTag(p)}>
                      {p.fullName}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => submitTag(null)}>
                  Create person &amp; save tag
                </button>
              </div>
            )}
            <h4>Details</h4>
            <div className="side-field">
              <span className="side-field-label">Date</span>
              <PhotoDateEditor
                storedDate={meta.date}
                onSave={async (date) => {
                  await saveMeta({ date });
                }}
              />
            </div>
            <label>
              Location
              <input
                value={meta.location ?? ""}
                onChange={(e) => setMeta((m) => ({ ...m, location: e.target.value }))}
                onBlur={() => void saveMeta({ location: meta.location })}
              />
            </label>
            <label>
              Description
              <textarea
                value={meta.description ?? ""}
                onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
                onBlur={() => void saveMeta({ description: meta.description })}
              />
            </label>
            <div className="move-box">
              <h4>Move</h4>
              <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
                <option value="">— Root —</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={async () => {
                  await postMove(photo.relPath, moveTarget || null);
                  onClose();
                  onRefresh();
                }}
              >
                Move here
              </button>
            </div>
            <button type="button" className="ghost close-bottom" onClick={onClose}>
              Close
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
