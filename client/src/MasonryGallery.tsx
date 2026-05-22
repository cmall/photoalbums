import { useEffect, useRef, useState } from "react";
import type { LibraryPhoto } from "./api";
import { mediaUrl } from "./api";

function truncate(s: string, max: number) {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const BATCH_SIZE = 48;

export function MasonryGallery({
  photos,
  imageCacheEpoch,
  onOpenIndex,
}: {
  photos: LibraryPhoto[];
  imageCacheEpoch: number;
  onOpenIndex: (index: number) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(BATCH_SIZE);
  }, [photos]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= photos.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + BATCH_SIZE, photos.length));
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [photos.length, visibleCount]);

  if (photos.length === 0) {
    return <p className="gallery-empty">No photos to show yet. Import albums from Album management.</p>;
  }

  const visible = photos.slice(0, visibleCount);

  return (
    <div className="masonry">
      {visible.map((p, i) => {
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
      {visibleCount < photos.length && (
        <div ref={sentinelRef} className="masonry-sentinel" aria-hidden />
      )}
    </div>
  );
}
