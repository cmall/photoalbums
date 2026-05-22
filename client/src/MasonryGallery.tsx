import type { LibraryPhoto } from "./api";
import { mediaUrl } from "./api";

function truncate(s: string, max: number) {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function MasonryGallery({
  photos,
  imageCacheEpoch,
  onOpenIndex,
}: {
  photos: LibraryPhoto[];
  imageCacheEpoch: number;
  onOpenIndex: (index: number) => void;
}) {
  if (photos.length === 0) {
    return <p className="gallery-empty">No photos to show yet. Import albums from Album management.</p>;
  }

  return (
    <div className="masonry">
      {photos.map((p, i) => {
        const desc = p.metadata.description?.trim();
        const hasPeople = (p.tags ?? []).length > 0;
        return (
          <article key={p.relPath} className="masonry-item">
            <button type="button" className="masonry-card" onClick={() => onOpenIndex(i)}>
              <div className="masonry-img-wrap">
                <img src={mediaUrl(p.relPath, "thumb", imageCacheEpoch)} alt="" loading="lazy" decoding="async" />
              </div>
              {(desc || hasPeople) && (
                <div className="masonry-card-meta">
                  {desc && <p className="masonry-caption">{truncate(desc, 120)}</p>}
                  {hasPeople && (
                    <p className="masonry-people">
                      {(p.tags ?? []).map((t) => t.fullName).join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </button>
          </article>
        );
      })}
    </div>
  );
}
