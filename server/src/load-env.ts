import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/** Repo root (parent of `server/` when cwd is the server workspace). */
function repoRoot() {
  return path.resolve(process.cwd(), "..");
}

function loadIfExists(filePath: string, override = false) {
  if (!fs.existsSync(filePath)) return;
  dotenv.config({ path: filePath, override });
}

/**
 * Load env files from the repo root (and optional server-local overrides).
 *
 * Development (`NODE_ENV` ≠ `production`): `.env`, `.env.local`, `.env.development`, …
 * Production build / start: `.env`, `.env.local`, `.env.production`, …
 *
 * Later files override earlier ones. Set `NODE_ENV=production` for `npm run build` and `npm start`.
 */
export function loadAppEnv() {
  const mode = process.env.NODE_ENV === "production" ? "production" : "development";
  const root = repoRoot();
  const serverDir = process.cwd();

  loadIfExists(path.join(root, ".env"));
  loadIfExists(path.join(root, ".env.local"), true);
  loadIfExists(path.join(root, `.env.${mode}`), true);
  loadIfExists(path.join(root, `.env.${mode}.local`), true);

  loadIfExists(path.join(serverDir, ".env"), true);
  loadIfExists(path.join(serverDir, `.env.${mode}`), true);
}
