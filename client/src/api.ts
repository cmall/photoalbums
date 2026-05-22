export type PhotoMetadata = {
  date?: string;
  location?: string;
  description?: string;
};

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { credentials: "include", ...init });
}

export type AuthStatus = { required: boolean; authenticated: boolean };

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const r = await apiFetch("/api/auth/status");
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<AuthStatus>;
}

export async function loginApi(password: string) {
  const r = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    let msg = "Login failed";
    try {
      const j = (await r.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      msg = await r.text();
    }
    throw new Error(msg);
  }
}

export async function logoutApi() {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

async function readApiError(r: Response) {
  if (r.status === 401) throw new AuthRequiredError();
  return r.text();
}

export type TagInfo = {
  personId: string;
  fullName: string;
  tagId: string;
  normX: number;
  normY: number;
  normW: number | null;
  normH: number | null;
};

export type LibraryPhoto = {
  relPath: string;
  filename: string;
  folder: string | null;
  /** File used for thumb/web (usually `*_a`); same as relPath when no enhancement. */
  thumbSourceRel: string;
  /** Scan of back of print, if present (`*_b`). */
  backRelPath: string | null;
  metadata: PhotoMetadata;
  tags: TagInfo[];
};

export type LibraryFolder = {
  name: string;
  photos: LibraryPhoto[];
  defaultYear: number | null;
  /** Folder exists on disk but not yet imported into the catalog. */
  needsImport: boolean;
  diskPhotoCount?: number;
};

export type LibraryResponse = {
  rootDefaultYear: number | null;
  rootPhotos: LibraryPhoto[];
  folders: LibraryFolder[];
};

export async function fetchLibrary(sync?: boolean): Promise<LibraryResponse> {
  const r = await apiFetch("/api/library" + (sync ? "?sync=1" : ""));
  if (!r.ok) throw new Error(await readApiError(r));
  return r.json() as Promise<LibraryResponse>;
}

export type HealthResponse = { ok: boolean; openInPhotoshop?: boolean };

export async function fetchHealth(): Promise<HealthResponse> {
  const r = await apiFetch("/api/health");
  if (!r.ok) throw new Error(await readApiError(r));
  return r.json() as Promise<HealthResponse>;
}

export type OpenPhotoshopVariant = "enhanced" | "primary" | "back";

/** Server runs `open`/Photoshop on the machine hosting the API (enable with ENABLE_OPEN_IN_PHOTOSHOP=1). */
export async function openInPhotoshopApi(relPath: string, variant: OpenPhotoshopVariant = "enhanced") {
  const r = await apiFetch("/api/open-photoshop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rel: relPath, variant }),
  });
  if (!r.ok) {
    let msg = await r.text();
    try {
      const j = JSON.parse(msg) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* raw text */
    }
    throw new Error(msg);
  }
}

export function mediaUrl(
  relPath: string,
  variant: "thumb" | "web" | "original" | "back" | "primary",
  cacheBust?: number,
) {
  const q = new URLSearchParams({ rel: relPath, variant });
  if (cacheBust != null && cacheBust > 0) q.set("_", String(cacheBust));
  return `/api/media?${q}`;
}

export async function refreshDerivativesApi(relPath: string) {
  const r = await apiFetch("/api/refresh-derivatives", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rel: relPath }),
  });
  if (!r.ok) {
    let msg = await r.text();
    try {
      const j = JSON.parse(msg) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* raw text */
    }
    throw new Error(msg);
  }
}

export async function deleteBackScanApi(relPath: string) {
  const r = await apiFetch("/api/delete-back-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rel: relPath }),
  });
  if (!r.ok) {
    let msg = await r.text();
    try {
      const j = JSON.parse(msg) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* raw text */
    }
    throw new Error(msg);
  }
}

export type ImportJobStatus = {
  id: string;
  folderName: string;
  status: string;
  total: number;
  done: number;
  error: string | null;
};

export async function startFolderImportApi(folderName: string): Promise<{ jobId: string }> {
  const r = await apiFetch("/api/folders/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderName }),
  });
  if (!r.ok) throw new Error(await readApiError(r));
  return r.json() as Promise<{ jobId: string }>;
}

export async function getImportJob(id: string): Promise<ImportJobStatus> {
  const r = await apiFetch(`/api/import/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(await readApiError(r));
  return r.json() as Promise<ImportJobStatus>;
}

export async function postMove(fromRel: string, toFolder: string | null, newFilename?: string) {
  const r = await apiFetch("/api/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromRel, toFolder, newFilename }),
  });
  if (!r.ok) throw new Error(await readApiError(r));
}

export async function createFolder(name: string) {
  const r = await apiFetch("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(await readApiError(r));
}

export async function renameFolder(oldName: string, newName: string) {
  const r = await apiFetch("/api/folders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldName, newName }),
  });
  if (!r.ok) throw new Error(await readApiError(r));
}

export async function patchMetadata(relPath: string, data: Partial<PhotoMetadata>) {
  const q = new URLSearchParams({ rel: relPath });
  const r = await apiFetch(`/api/metadata?${q}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await readApiError(r));
  return r.json() as Promise<PhotoMetadata>;
}

export type Person = { id: string; fullName: string };

export async function searchPersons(term: string): Promise<Person[]> {
  const q = new URLSearchParams({ q: term, limit: "20" });
  const r = await apiFetch(`/api/persons?${q}`);
  if (!r.ok) throw new Error(await readApiError(r));
  const j = (await r.json()) as { persons: Person[] };
  return j.persons;
}

export async function createPerson(fullName: string): Promise<Person> {
  const r = await apiFetch("/api/persons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName }),
  });
  if (!r.ok) throw new Error(await readApiError(r));
  return r.json() as Promise<Person>;
}

export async function addTag(
  relPath: string,
  personId: string,
  normX: number,
  normY: number,
) {
  const r = await apiFetch("/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      relPath,
      personId,
      normX,
      normY,
    }),
  });
  if (!r.ok) throw new Error(await readApiError(r));
}

export async function deleteTag(tagId: string) {
  const r = await apiFetch(`/api/tags/${encodeURIComponent(tagId)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await readApiError(r));
}

export async function patchTagPosition(tagId: string, normX: number, normY: number) {
  const r = await apiFetch("/api/tag-position", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tagId, normX, normY }),
  });
  if (!r.ok) throw new Error(await readApiError(r));
}

export async function photosForPerson(personId: string): Promise<{ relPath: string }[]> {
  const r = await apiFetch(`/api/persons/${encodeURIComponent(personId)}/photos`);
  if (!r.ok) throw new Error(await readApiError(r));
  const j = (await r.json()) as { photos: { relPath: string }[] };
  return j.photos;
}
