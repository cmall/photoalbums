export type AppRoute =
  | { kind: "gallery-hub" }
  | { kind: "gallery-album"; folder: string; lightboxIndex?: number }
  | { kind: "manage-hub" }
  | { kind: "manage-album"; folder: string }
  | { kind: "photo"; rel: string };

export function parseRoute(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/gallery") return { kind: "gallery-hub" };

  const photoMatch = path.match(/^\/photo\/(.+)$/);
  if (photoMatch) {
    try {
      return { kind: "photo", rel: decodeURIComponent(photoMatch[1]!) };
    } catch {
      return { kind: "gallery-hub" };
    }
  }

  const galleryAlbumMatch = path.match(/^\/album\/([^/]+)(?:\/i\/(\d+))?$/);
  if (galleryAlbumMatch) {
    try {
      const folder = decodeURIComponent(galleryAlbumMatch[1]!);
      const lightboxIndex =
        galleryAlbumMatch[2] != null ? Number(galleryAlbumMatch[2]) : undefined;
      return {
        kind: "gallery-album",
        folder,
        lightboxIndex: Number.isFinite(lightboxIndex) ? lightboxIndex : undefined,
      };
    } catch {
      return { kind: "gallery-hub" };
    }
  }

  const manageMatch = path.match(/^\/manage(?:\/([^/]+))?$/);
  if (manageMatch) {
    if (manageMatch[1]) {
      try {
        return { kind: "manage-album", folder: decodeURIComponent(manageMatch[1]) };
      } catch {
        return { kind: "manage-hub" };
      }
    }
    return { kind: "manage-hub" };
  }

  return { kind: "gallery-hub" };
}

export function routeToPath(route: AppRoute): string {
  switch (route.kind) {
    case "gallery-hub":
      return "/";
    case "gallery-album": {
      const base = `/album/${encodeURIComponent(route.folder)}`;
      if (route.lightboxIndex != null && route.lightboxIndex >= 0) {
        return `${base}/i/${route.lightboxIndex}`;
      }
      return base;
    }
    case "manage-hub":
      return "/manage";
    case "manage-album":
      return `/manage/${encodeURIComponent(route.folder)}`;
    case "photo":
      return `/photo/${encodeURIComponent(route.rel)}`;
  }
}

export function folderFromRel(rel: string): string | null {
  const slash = rel.indexOf("/");
  return slash > 0 ? rel.slice(0, slash) : null;
}
