# Albums

Local web app for organizing a photo library: one level of folders under a root directory, metadata sidecars (JSON), a SQLite index (including people tags), and cached thumbnails plus web-sized images.

## Prerequisites

- **Node.js** (LTS recommended; includes `npm`)
- **macOS / Linux / Windows** — the server uses native modules (`better-sqlite3`, `sharp`). If install fails, use the versions your platform’s Node build expects.

## Setup

1. **Install dependencies** (from this repo root):

   ```bash
   npm install
   ```

2. **Configure the library path.** Copy the example env file and edit it:

   ```bash
   cp .env.example .env
   ```

   Set **`PHOTO_LIBRARY_ROOT`** to the **absolute path** of the folder that holds your photos (images in the root and in immediate subfolders only; no deeper nesting).

   Optional variables are documented in `.env.example` (cache directory, SQLite path, host, port).

## Development

Run the API and the Vite dev UI together:

```bash
npm run dev
```

- **UI:** the terminal shows the real URL (often [http://127.0.0.1:5173](http://127.0.0.1:5173)). If 5173 is already in use, Vite uses another port (e.g. **5174**). That dev server proxies `/api` to the backend.
- **API:** [http://127.0.0.1:8787](http://127.0.0.1:8787) by default — set `PORT` in `.env` at the **repo root** if you need a different port; Vite’s proxy uses the same value.

Use **Scan library** in the app after adding or changing files on disk (or rely on actions that trigger a sync). On server startup, an initial scan runs **in the background** so `npm run dev` can open the API port immediately; tags/metadata in the DB catch up within seconds to minutes depending on library size.

## Production (single server)

Build the client and start the API. If `client/dist` exists, the server also serves the built UI on the **same port** as the API (useful behind **Cloudflare Tunnel** or another reverse proxy).

```bash
npm run build
npm start
```

Ensure `.env` is present (repo root or process environment) with **`PHOTO_LIBRARY_ROOT`** set — the server resolves `../.env` from the `server` workspace when you run `npm start`.

Then open **http://127.0.0.1:8787** (or your configured `HOST` / `PORT`).

## Where data lives

| Item | Default location |
|------|------------------|
| Original photos | Your `PHOTO_LIBRARY_ROOT` |
| Per-photo metadata JSON | Next to each image: `basename.json` |
| SQLite database | `ALBUMS_DB_PATH` (e.g. `/Users/cm/AlbumData/scanned.sqlite`) |
| Thumbnails / web previews | `PHOTO_CACHE_DIR` (e.g. `/Users/cm/AlbumData/Scanned/Cache`) |

## Troubleshooting

- **`http proxy error` / `ECONNREFUSED 127.0.0.1:8787` in the `[client]` logs** — the browser UI is up, but the **API never started** or is not on that port. In the same terminal, look at **`[server]`** lines above: you should see `Server listening at http://127.0.0.1:8787`. If the server exited, the usual message is **`PHOTO_LIBRARY_ROOT is required`** — add it to **`.env` in the repo root** (same folder as `package.json`), save, and run `npm run dev` again.
- **`PHOTO_LIBRARY_ROOT is required`** — define it in `.env` at the repo root, or export it in your shell before starting the server.
- **Empty library** — check the path, then use **Scan library** in the UI.
- **Port in use** — set `PORT` in `.env` to another value; Vite loads that for the API proxy automatically.
