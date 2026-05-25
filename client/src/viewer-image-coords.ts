/** Normalized 0–1 coords on the visible image (object-fit: contain aware). */
export function pointerClientToImageNorm(
  clientX: number,
  clientY: number,
  img: HTMLImageElement,
): { x: number; y: number } | null {
  const r = img.getBoundingClientRect();
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  if (r.width <= 0 || r.height <= 0) return null;

  if (naturalW > 0 && naturalH > 0) {
    const scale = Math.min(r.width / naturalW, r.height / naturalH);
    const renderedW = naturalW * scale;
    const renderedH = naturalH * scale;
    const left = r.left + (r.width - renderedW) / 2;
    const top = r.top + (r.height - renderedH) / 2;
    const x = (clientX - left) / renderedW;
    const y = (clientY - top) / renderedH;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }

  const x = (clientX - r.left) / r.width;
  const y = (clientY - r.top) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** Pixel rect of the visible image within its layout box (for marker overlay). */
export function imageRenderBox(img: HTMLImageElement) {
  const r = img.getBoundingClientRect();
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  if (r.width <= 0 || r.height <= 0 || naturalW <= 0 || naturalH <= 0) {
    return { left: 0, top: 0, width: r.width, height: r.height };
  }
  const scale = Math.min(r.width / naturalW, r.height / naturalH);
  const width = naturalW * scale;
  const height = naturalH * scale;
  return {
    left: (r.width - width) / 2,
    top: (r.height - height) / 2,
    width,
    height,
  };
}

export type ImageMarkerOverlayBox = {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
};

/** Overlay box as percentages of the image element (object-fit: contain). */
export function imageMarkerOverlayBox(img: HTMLImageElement): ImageMarkerOverlayBox {
  const w = img.clientWidth;
  const h = img.clientHeight;
  if (w <= 0 || h <= 0) {
    return { leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 };
  }
  const box = imageRenderBox(img);
  return {
    leftPct: (box.left / w) * 100,
    topPct: (box.top / h) * 100,
    widthPct: (box.width / w) * 100,
    heightPct: (box.height / h) * 100,
  };
}
