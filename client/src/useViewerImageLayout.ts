import { useEffect, useState, type RefObject } from "react";
import { imageMarkerOverlayBox, type ImageMarkerOverlayBox } from "./viewer-image-coords";

const DEFAULT_OVERLAY: ImageMarkerOverlayBox = {
  leftPct: 0,
  topPct: 0,
  widthPct: 100,
  heightPct: 100,
};

export function useViewerImageLayout(
  imgRef: RefObject<HTMLImageElement | null>,
  resetKey: string,
): ImageMarkerOverlayBox {
  const [overlay, setOverlay] = useState<ImageMarkerOverlayBox>(DEFAULT_OVERLAY);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const update = () => {
      setOverlay(imageMarkerOverlayBox(img));
    };

    update();
    img.addEventListener("load", update);
    const ro = new ResizeObserver(update);
    ro.observe(img);
    const frame = img.parentElement;
    if (frame) ro.observe(frame);

    return () => {
      img.removeEventListener("load", update);
      ro.disconnect();
    };
  }, [imgRef, resetKey]);

  return overlay;
}
