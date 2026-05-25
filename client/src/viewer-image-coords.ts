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
