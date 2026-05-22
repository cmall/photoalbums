import type { LibraryPhoto } from "./api";
import { mediaUrl } from "./api";

export type GalleryAlbumHubEntry = { name: string; photos: LibraryPhoto[]; photoCount: number };

export function GalleryAlbumHub({
  albums,
  imageCacheEpoch,
  onOpenPhoto,
  onOpenAlbumGrid,
}: {
  albums: GalleryAlbumHubEntry[];
  imageCacheEpoch: number;
  onOpenPhoto: (folderName: string, indexInFolder: number) => void;
  onOpenAlbumGrid: (folderName: string) => void;
}) {
  if (albums.length === 0) {
    return (
      <p className="gallery-empty">
        No album photos match this view. Import a folder from Album management, or clear the person filter.
      </p>
    );
  }

  return (
    <div className="gallery-album-hub">
      {albums.map((album) => {
        const thumbs = album.photos.slice(0, 4);
        const padCount = Math.max(0, 4 - thumbs.length);
        return (
          <section key={album.name} className="gallery-album-block" aria-label={`Album ${album.name}`}>
            <div className="gallery-album-block-head">
              <button
                type="button"
                className="gallery-album-block-title"
                onClick={() => onOpenAlbumGrid(album.name)}
              >
                {album.name}
              </button>
              <span className="gallery-album-block-count">{album.photoCount} photos</span>
            </div>
            <div className="gallery-album-thumb-grid">
              {thumbs.map((p, i) => (
                <button
                  key={p.relPath}
                  type="button"
                  className="gallery-album-thumb"
                  onClick={() => onOpenPhoto(album.name, i)}
                >
                  <img
                    src={mediaUrl(p.relPath, "thumb", imageCacheEpoch)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              ))}
              {Array.from({ length: padCount }, (_, i) => (
                <div key={`pad-${album.name}-${i}`} className="gallery-album-thumb-pad" aria-hidden />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
