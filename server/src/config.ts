import path from "node:path";
import { loadAppEnv } from "./load-env.js";
import { serverRootDir } from "./install-paths.js";

loadAppEnv();

const root = process.env.PHOTO_LIBRARY_ROOT ?? "";
const cache =
  process.env.PHOTO_CACHE_DIR ?? path.join(serverRootDir(), ".photo-cache");

export const config = {
  photoRoot: path.resolve(root),
  cacheDir: path.resolve(cache),
  dbPath: process.env.ALBUMS_DB_PATH ?? path.join(serverRootDir(), "data", "albums.sqlite"),
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  /** Launch Photoshop on the server machine via /api/open-photoshop (local workflow). */
  openInPhotoshopEnabled:
    process.env.ENABLE_OPEN_IN_PHOTOSHOP === "1" ||
    process.env.ENABLE_OPEN_IN_PHOTOSHOP === "true",
  /** When set, the UI requires a password (session cookie after login). */
  appPassword: process.env.APP_PASSWORD ?? "",
  /** Set to 1 when serving over HTTPS so session cookies use the Secure flag. */
  secureCookies:
    process.env.APP_SECURE_COOKIES === "1" || process.env.APP_SECURE_COOKIES === "true",
};

export function assertConfig() {
  if (!root) {
    const mode = process.env.NODE_ENV === "production" ? "production" : "development";
    throw new Error(
      `PHOTO_LIBRARY_ROOT is required. Set it in .env or .env.${mode} at the repo root.`,
    );
  }
}
