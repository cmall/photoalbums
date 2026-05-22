import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to `server/` (stable when cwd differs under launchd). */
export function serverRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** Absolute path to the repo root (parent of `server/`). */
export function repoRootDir() {
  return path.resolve(serverRootDir(), "..");
}
