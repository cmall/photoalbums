import { useCallback, useEffect, useState } from "react";
import type { LibraryPhoto } from "./api";
import { mediaUrl, openInPhotoshopApi, refreshDerivativesApi } from "./api";

type ImageSource = "enhanced" | "primary" | "back";

function captionFromPhoto(p: LibraryPhoto): string | null {
  const d = p.metadata.description?.trim();
  return d || null;
}

export function GalleryLightbox({
  photos,
  index,
  openInPhotoshopEnabled,
  imageCacheEpoch,
  onDerivativesRefreshed,
  onClose,
  onNavigate,
  onEditDetails,
}: {
  photos: LibraryPhoto[];
  index: number;
  openInPhotoshopEnabled: boolean;
  imageCacheEpoch: number;
  onDerivativesRefreshed: () => void;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
  onEditDetails: (photo: LibraryPhoto) => void;
}) {
  const photo = photos.length ? photos[Math.min(Math.max(0, index), photos.length - 1)]! : null;
  const [imageSource, setImageSource] = useState<ImageSource>("enhanced");
  const [highlightedTagId, setHighlightedTagId] = useState<string | null>(null);
  const [showAllFaces, setShowAllFaces] = useState(true);
  const [refreshingPreview, setRefreshingPreview] = useState(false);

  useEffect(() => {
    setImageSource("enhanced");
    setHighlightedTagId(null);
  }, [photo?.relPath]);

  const hasBack = photo != null && photo.backRelPath != null;
  const hasEnhanced = photo != null && photo.thumbSourceRel !== photo.relPath;

  const viewerSrc =
    photo == null
      ? ""
      : imageSource === "back" && hasBack
        ? mediaUrl(photo.relPath, "back", imageCacheEpoch)
        : imageSource === "primary" && hasEnhanced
          ? mediaUrl(photo.relPath, "primary", imageCacheEpoch)
          : mediaUrl(photo.relPath, "web", imageCacheEpoch);

  const navLen = photos.length;
  const canNavigate = navLen > 1;

  const go = useCallback(
    (delta: number) => {
      if (!canNavigate || !photo) return;
      const j = (index + delta + navLen) % navLen;
      onNavigate(j);
    },
    [canNavigate, navLen, index, onNavigate, photo],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!photo) return null;

  const caption = captionFromPhoto(photo);
  const sortedTags = [...photo.tags].sort((a, b) => a.normX - b.normX);
  const showFaceLayer = imageSource === "enhanced" && sortedTags.length > 0;

  return (
    <div className="lightbox-back" role="dialog" aria-modal="true" aria-label="Photo lightbox">
      <button type="button" className="lightbox-scrim" aria-label="Close" onClick={onClose} />
      <div className="lightbox-shell">
        <header className="lightbox-top">
          <div className="lightbox-nav">
            <button type="button" className="lightbox-arrow" disabled={!canNavigate} onClick={() => go(-1)} aria-label="Previous photo">
              ‹
            </button>
            <span className="lightbox-count">
              {index + 1} / {navLen}
            </span>
            <button type="button" className="lightbox-arrow" disabled={!canNavigate} onClick={() => go(1)} aria-label="Next photo">
              ›
            </button>
          </div>
          <button type="button" className="lightbox-close ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="lightbox-body">
          <div className="lightbox-stage">
            <div className="lightbox-img-wrap">
              <img src={viewerSrc} alt="" className="lightbox-img" />
              {showFaceLayer &&
                sortedTags.map((t) => {
                  if (!showAllFaces && highlightedTagId !== t.tagId) return null;
                  const dim = showAllFaces && highlightedTagId != null && highlightedTagId !== t.tagId;
                  const on = highlightedTagId === t.tagId;
                  return (
                    <span
                      key={t.tagId}
                      className={
                        "lightbox-face-marker" +
                        (on ? " lightbox-face-on" : "") +
                        (dim ? " lightbox-face-dim" : "")
                      }
                      style={{ left: `${t.normX * 100}%`, top: `${t.normY * 100}%` }}
                      aria-hidden
                    />
                  );
                })}
            </div>
            <div className="lightbox-img-tools" role="toolbar" aria-label="Photo actions">
              {hasBack && (
                <button
                  type="button"
                  className="lightbox-tool-btn"
                  onClick={() => setImageSource((s) => (s === "back" ? "enhanced" : "back"))}
                >
                  {imageSource === "back" ? "View front" : "Back of photo"}
                </button>
              )}
              {hasEnhanced && (
                <button
                  type="button"
                  className="lightbox-tool-btn"
                  onClick={() => setImageSource((s) => (s === "primary" ? "enhanced" : "primary"))}
                >
                  {imageSource === "primary" ? "Enhanced view" : "Original scan"}
                </button>
              )}
              <a className="lightbox-tool-btn" href={mediaUrl(photo.relPath, "original")}>
                Download file
              </a>
              <button type="button" className="lightbox-tool-btn" onClick={() => onEditDetails(photo)}>
                Edit tags &amp; details
              </button>
              {openInPhotoshopEnabled && (
                <button
                  type="button"
                  className="lightbox-tool-btn"
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
                className="lightbox-tool-btn"
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
            <p className="lightbox-key-hint">← → navigate · Esc close</p>
          </div>

          <aside className="lightbox-side">
            {caption && (
              <section className="lightbox-section">
                <h3 className="lightbox-side-title">Caption</h3>
                <p className="lightbox-caption-body">{caption}</p>
              </section>
            )}
            {photo.metadata.date?.trim() && (
              <p className="lightbox-meta-line">
                <strong>Date:</strong> {photo.metadata.date}
              </p>
            )}
            {photo.metadata.location?.trim() && (
              <p className="lightbox-meta-line">
                <strong>Place:</strong> {photo.metadata.location}
              </p>
            )}
            {photo.folder && (
              <p className="lightbox-meta-line">
                <strong>Album:</strong> {photo.folder}
              </p>
            )}

            {sortedTags.length > 0 && imageSource === "enhanced" && (
              <section className="lightbox-section">
                <div className="lightbox-people-head">
                  <h3 className="lightbox-side-title">People</h3>
                  <label className="lightbox-toggle-faces">
                    <input
                      type="checkbox"
                      checked={showAllFaces}
                      onChange={() => setShowAllFaces((v) => !v)}
                    />
                    Show all locations
                  </label>
                </div>
                <ul className="lightbox-people">
                  {sortedTags.map((t) => (
                    <li key={t.tagId}>
                      <button
                        type="button"
                        className={
                          "lightbox-person" +
                          (highlightedTagId === t.tagId ? " lightbox-person-on" : "")
                        }
                        onMouseEnter={() => setHighlightedTagId(t.tagId)}
                        onMouseLeave={() => setHighlightedTagId(null)}
                        onFocus={() => setHighlightedTagId(t.tagId)}
                        onBlur={() => setHighlightedTagId(null)}
                      >
                        {t.fullName}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="lightbox-hint faint">Hover a name to highlight their position on the photo.</p>
              </section>
            )}
            {sortedTags.length > 0 && imageSource !== "enhanced" && (
              <p className="lightbox-hint faint">Face locations are shown on the enhanced (front) view.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
